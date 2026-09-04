import { describe, it, expect } from 'vitest';
import { ExtractionService } from './extraction-service.js';
import { EXTRACTION_SYSTEM_PROMPT } from './prompt.js';
import { referenceDateFor } from './extraction-service.js';
import { InMemoryClientRepository } from '../../adapters/clients/in-memory-client-repository.js';
import { InMemoryNoteRepository } from '../../adapters/notes/in-memory-note-repository.js';
import { InMemoryFactsRepository } from '../../adapters/facts/in-memory-facts-repository.js';
import { InMemoryExtractionLogRepository } from '../../adapters/logs/in-memory-extraction-log-repository.js';
import { InMemoryMeetingRepository } from '../../adapters/meetings/in-memory-meeting-repository.js';
import { StubEmbedder } from '../../adapters/embedding/stub.js';
import type { ModelClient } from '../../ports/model.js';
import type { Embedder } from '../../ports/embedder.js';

const VALID = JSON.stringify({
  summary: 'Rep committed to sending the revised quote.',
  promises: [{ text: 'Send the revised quote', owner: 'rep', due_date: '2026-07-10', due_raw: 'Friday', confidence: 'high' }],
  people: [],
  personal_facts: [],
  key_dates: [],
  concerns: [],
  next_steps: [],
  meeting: null,
});

const WITH_MEETING = JSON.stringify({
  summary: 'Client proposed a meeting next Tuesday.',
  promises: [], people: [], personal_facts: [], key_dates: [], concerns: [], next_steps: [],
  meeting: { datetime: '2026-07-14T15:00', datetime_raw: 'next Tuesday 3pm', confirmed: false },
});

function model(...responses: string[]): ModelClient {
  let i = 0;
  return { complete: async () => ({ text: responses[Math.min(i++, responses.length - 1)]! }) };
}

/** A model that records the last request it was asked to complete. */
function capturingModel(text: string): { client: ModelClient; last: () => Parameters<ModelClient['complete']>[0] | null } {
  let seen: Parameters<ModelClient['complete']>[0] | null = null;
  return { client: { complete: async (req) => { seen = req; return { text }; } }, last: () => seen };
}

async function setup(m: ModelClient, cacheTtl?: '5m' | '1h', embedder: Embedder = new StubEmbedder(8)) {
  const clients = new InMemoryClientRepository();
  const notes = new InMemoryNoteRepository();
  const facts = new InMemoryFactsRepository();
  const client = await clients.create('user-A', 'Meridian Corp');
  const note = await notes.create('user-A', {
    clientId: client.id,
    source: 'paste',
    rawText: "I'll send the revised quote by Friday",
    audioKey: null,
    status: 'pending_extraction',
  });
  const logs = new InMemoryExtractionLogRepository();
  const service = new ExtractionService(m, clients, notes, facts, embedder, logs, 'stub', undefined, undefined, undefined, cacheTtl);
  return { service, notes, facts, note, logs };
}

describe('ExtractionService', () => {
  it('stores facts to JSONB, promises to the spine, and marks the note extracted', async () => {
    const { service, notes, facts, note } = await setup(model(VALID));
    const out = await service.extractNote('user-A', note.id, '2026-07-09');
    expect(out.status).toBe('extracted');
    const stored = await notes.findByIdForUser('user-A', note.id);
    expect(stored?.status).toBe('extracted');
    expect((stored?.extracted as { summary: string }).summary).toContain('revised quote');
    const promises = await facts.listPromisesByNote('user-A', note.id);
    expect(promises).toHaveLength(1);
    expect(promises[0]!.owner).toBe('rep');
  });

  it('[NUDGE-UNCONFIRMED] persists a proposed meeting (confirmed:false) idempotently, on the rep\'s clock', async () => {
    const clients = new InMemoryClientRepository();
    const notes = new InMemoryNoteRepository();
    const facts = new InMemoryFactsRepository();
    const meetings = new InMemoryMeetingRepository();
    const client = await clients.create('user-A', 'Meridian Corp');
    const note = await notes.create('user-A', { clientId: client.id, source: 'paste', rawText: 'meeting next Tuesday 3pm', audioKey: null, status: 'pending_extraction' });
    const logs = new InMemoryExtractionLogRepository();
    const svc = new ExtractionService(model(WITH_MEETING), clients, notes, facts, new StubEmbedder(8), logs, 'stub', undefined, undefined, undefined, undefined, meetings, async () => 'Asia/Dubai');

    await svc.extractNote('user-A', note.id, '2026-07-09');
    const persisted = await meetings.findByNoteId('user-A', note.id);
    expect(persisted?.confirmed).toBe(false); // waits for the rep — never booked silently
    expect(persisted?.datetime).toBe('2026-07-14T11:00:00.000Z'); // 15:00 Dubai → 11:00Z
    expect(persisted?.datetimeRaw).toBe('next Tuesday 3pm');
    expect(persisted?.noteId).toBe(note.id);
    // an unconfirmed meeting is NOT nudge-eligible
    expect(await meetings.dueForNudge('user-A', '2026-07-14T00:00:00.000Z', '2026-07-14T23:59:59.000Z')).toHaveLength(0);
    // confirming makes it nudge-eligible
    await meetings.confirm('user-A', persisted!.id);
    expect(await meetings.dueForNudge('user-A', '2026-07-14T00:00:00.000Z', '2026-07-14T23:59:59.000Z')).toHaveLength(1);
    // idempotent: no duplicate meeting for the same note
    await notes.update('user-A', note.id, { status: 'pending_extraction' });
    await svc.extractNote('user-A', note.id, '2026-07-09');
    expect((await meetings.listByUser('user-A')).filter((m) => m.noteId === note.id)).toHaveLength(1);
  });

  // Embedding is best-effort: if the embedder throws (e.g. Bedrock model access not
  // granted / an outage), the FACTS must still be saved and the note marked extracted —
  // "never lose a recording". Only semantic search for the note degrades (null vector).
  it('saves facts and marks extracted even when the embedder fails (no lost recording)', async () => {
    const throwing: Embedder = { dimension: 8, embed: async () => { throw new Error('bedrock AccessDeniedException'); } };
    const { service, notes, facts, note } = await setup(model(VALID), undefined, throwing);
    const out = await service.extractNote('user-A', note.id, '2026-07-09');
    expect(out.status).toBe('extracted'); // NOT an error/needs_review
    const stored = await notes.findByIdForUser('user-A', note.id);
    expect(stored?.status).toBe('extracted');
    expect((stored?.extracted as { summary: string } | null)?.summary).toContain('revised quote');
    // The vector is skipped (recall for this note degrades), but the FACTS are kept:
    expect(await facts.listPromisesByNote('user-A', note.id)).toHaveLength(1);
  });

  // [CACHE] Extraction MUST request prompt caching, with the byte-identical
  // system prefix — that is the whole cost lever on Sonnet.
  it('requests prompt caching with the byte-identical system prefix', async () => {
    const cap = capturingModel(VALID);
    const { service, note } = await setup(cap.client);
    await service.extractNote('user-A', note.id, '2026-07-09');
    const req = cap.last()!;
    expect(req.cacheSystemPrompt).toBe(true);
    expect(req.system).toBe(EXTRACTION_SYSTEM_PROMPT);
    // The variable bits (today's date, client) live in the message, NOT the prefix.
    expect(req.system).not.toContain('2026-07-09');
  });

  // [CACHE] The configured cache TTL is forwarded on the request (1h / 5m switch).
  it('forwards the configured cache TTL to the model request', async () => {
    const capA = capturingModel(VALID);
    const a = await setup(capA.client, '1h');
    await a.service.extractNote('user-A', a.note.id, '2026-07-09');
    expect(capA.last()!.cacheTtl).toBe('1h');

    const capB = capturingModel(VALID);
    const b = await setup(capB.client, '5m');
    await b.service.extractNote('user-A', b.note.id, '2026-07-09');
    expect(capB.last()!.cacheTtl).toBe('5m');
  });

  // NEGATIVE: malformed output is retried once; a valid retry succeeds.
  it('retries once and succeeds when the first response is malformed', async () => {
    const { service, note } = await setup(model('not json', VALID));
    const out = await service.extractNote('user-A', note.id, '2026-07-09');
    expect(out.status).toBe('extracted');
  });

  // NEGATIVE: two malformed responses → flag the note, write NOTHING structured.
  it('flags the note and writes no structured data after a failed retry', async () => {
    const { service, notes, facts, note } = await setup(model('garbage', 'still garbage'));
    const out = await service.extractNote('user-A', note.id, '2026-07-09');
    expect(out.flagged).toBe(true);
    expect(out.status).toBe('needs_review');
    const stored = await notes.findByIdForUser('user-A', note.id);
    expect(stored?.status).toBe('needs_review');
    expect(stored?.extracted).toBeNull(); // no partial JSONB write
    expect(await facts.listPromisesByNote('user-A', note.id)).toEqual([]); // no spine rows
  });

  // NEGATIVE: valid JSON that violates the schema is treated as a failure.
  it('flags the note when the JSON is valid but the schema is wrong', async () => {
    const schemaWrong = JSON.stringify({ summary: 'x', promises: 'not-an-array' });
    const { service, notes, note } = await setup(model(schemaWrong, schemaWrong));
    const out = await service.extractNote('user-A', note.id, '2026-07-09');
    expect(out.status).toBe('needs_review');
    expect((await notes.findByIdForUser('user-A', note.id))?.extracted).toBeNull();
  });

  it('re-extraction is idempotent on the spine (no duplicate promises)', async () => {
    const { service, facts, note } = await setup(model(VALID));
    await service.extractNote('user-A', note.id, '2026-07-09');
    await service.extractNote('user-A', note.id, '2026-07-09');
    expect(await facts.listPromisesByNote('user-A', note.id)).toHaveLength(1);
  });


  it('[DATE-REF] resolves an imported chat against its latest message date, not now', () => {
    const iso = referenceDateFor({ messages: [{ sentAt: '2026-03-05' }, { sentAt: '2026-03-10' }] }, '2026-09-01');
    expect(iso).toBe('2026-03-10'); // message era, NOT the import date
    const wa = referenceDateFor({ messages: [{ sentAt: '10/03/2026, 14:00' }] }, '2026-09-01');
    expect(wa).toBe('2026-03-10'); // WhatsApp DD/MM/YYYY parsed
    expect(referenceDateFor({ messages: null }, '2026-09-01')).toBe('2026-09-01'); // fresh → caller's today
  });

  it('[DATE-INVARIANT] nulls a promise dated before the note reference (fresh note cannot be past-due)', async () => {
    const past = JSON.stringify({ ...JSON.parse(VALID), promises: [{ text: 'Send the quote', owner: 'rep', due_date: '2026-07-01', due_raw: 'Monday', confidence: 'high' }] });
    const { service, notes, facts, note } = await setup(model(past)); // note today = 2026-07-09 (reference), due 2026-07-01 is BEFORE it
    await service.extractNote('user-A', note.id, '2026-07-09');
    const stored = (await notes.findByIdForUser('user-A', note.id))!.extracted as { promises: { due_date: string | null; confidence: string }[] };
    expect(stored.promises[0]!.due_date).toBeNull();   // nulled
    expect(stored.promises[0]!.confidence).toBe('low'); // queued to confirmation
    expect((await facts.listPromisesByNote('user-A', note.id))[0]!.dueDate).toBeNull(); // spine agrees
  });

  // [P1-8] logging
  it('writes exactly one log row per extraction with model, version, input and output', async () => {
    const { service, logs, note } = await setup(model(VALID));
    await service.extractNote('user-A', note.id, '2026-07-09');
    const rows = await logs.listByUser('user-A');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.model).toBe('stub');
    expect(rows[0]!.promptVersion).toBe('tovira-extract-v0.9.3');
    expect(rows[0]!.status).toBe('extracted');
    expect(rows[0]!.input).toContain('revised quote');
    expect(rows[0]!.rawOutput).toBe(VALID);
  });

  it('logs exactly one row even when a retry happens', async () => {
    const { service, logs, note } = await setup(model('bad', VALID));
    await service.extractNote('user-A', note.id, '2026-07-09');
    expect(await logs.listByUser('user-A')).toHaveLength(1);
  });

  // NEGATIVE: a failed extraction still writes a log row recording the failure.
  it('logs the failure (one row) when extraction is flagged', async () => {
    const { service, logs, note } = await setup(model('garbage', 'still garbage'));
    await service.extractNote('user-A', note.id, '2026-07-09');
    const rows = await logs.listByUser('user-A');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('needs_review');
    expect(rows[0]!.rawOutput).toBe('still garbage'); // the failed output is captured
  });

  // P5-1: a trial account over the extraction ceiling is stopped before the model
  // call — nothing breaks, the note is left pending, no model spend.
  it('stops extraction when the trial limiter denies it', async () => {
    const clients = new InMemoryClientRepository();
    const notes = new InMemoryNoteRepository();
    const facts = new InMemoryFactsRepository();
    const logs = new InMemoryExtractionLogRepository();
    const client = await clients.create('u', 'Acme');
    const note = await notes.create('u', { clientId: client.id, source: 'paste', rawText: 'hi', audioKey: null, status: 'pending_extraction' });
    let called = 0;
    const svc = new ExtractionService(
      { complete: async () => { called += 1; return { text: '{}' }; } },
      clients, notes, facts, new StubEmbedder(8), logs, 'stub', undefined, undefined,
      { allow: async () => false }, // over the ceiling
    );
    const out = await svc.extractNote('u', note.id, '2026-07-09');
    expect(out.status).toBe('trial_limit');
    expect(called).toBe(0); // never called the model
    expect((await notes.findByIdForUser('u', note.id))!.status).toBe('pending_extraction'); // note untouched
  });

  // MISFILE-POST (B2): after extraction, a note whose people belong only to another client gets a
  // soft move-suggestion; a correctly-filed note gets none.
  it('stores a move-suggestion when a note mentions only another client\'s people', async () => {
    const person = (name: string) => ({ name, role: null, reports_to: null, decision_role: 'unknown', notes: null });
    const extraction = JSON.stringify({ summary: 'Talked to Sarah and Jordan.', promises: [], people: [person('Sarah'), person('Jordan')], personal_facts: [], key_dates: [], concerns: [], next_steps: [], meeting: null });

    const clients = new InMemoryClientRepository();
    const notes = new InMemoryNoteRepository();
    const facts = new InMemoryFactsRepository();
    const logs = new InMemoryExtractionLogRepository();
    const meridian = await clients.create('user-A', 'Meridian');
    const newco = await clients.create('user-A', 'Newco');
    // Seed Meridian's record with Sarah + Jordan (a prior extracted note).
    const prior = await notes.create('user-A', { clientId: meridian.id, source: 'paste', rawText: 'x', audioKey: null, status: 'pending_extraction' });
    await notes.update('user-A', prior.id, { status: 'extracted', extracted: JSON.parse(extraction) });

    // A voice note filed under NEWCO mentioning only Sarah + Jordan → suggest moving to Meridian.
    const misfiled = await notes.create('user-A', { clientId: newco.id, source: 'voice', rawText: 'talked to Sarah and Jordan', audioKey: null, status: 'pending_extraction' });
    const svc = new ExtractionService(model(extraction), clients, notes, facts, new StubEmbedder(8), logs, 'stub');
    await svc.extractNote('user-A', misfiled.id, '2026-07-09');
    const stored = await notes.findByIdForUser('user-A', misfiled.id);
    expect(stored?.moveSuggestion?.toClientId).toBe(meridian.id);
    expect(stored?.moveSuggestion?.mentioned).toEqual(expect.arrayContaining(['Sarah', 'Jordan']));

    // A note correctly filed under Meridian (overlap with its record) → NO suggestion.
    const ok = await notes.create('user-A', { clientId: meridian.id, source: 'voice', rawText: 'x', audioKey: null, status: 'pending_extraction' });
    const svc2 = new ExtractionService(model(extraction), clients, notes, facts, new StubEmbedder(8), logs, 'stub');
    await svc2.extractNote('user-A', ok.id, '2026-07-09');
    expect((await notes.findByIdForUser('user-A', ok.id))?.moveSuggestion ?? null).toBeNull();
  });
});
