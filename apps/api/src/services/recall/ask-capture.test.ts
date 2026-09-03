import { describe, it, expect } from 'vitest';
import { AskCaptureService } from './ask-capture-service.js';
import { ExtractionService } from '../extraction/extraction-service.js';
import { PROMPT_VERSION } from '../extraction/prompt.js';
import { InMemoryClientRepository } from '../../adapters/clients/in-memory-client-repository.js';
import { InMemoryNoteRepository } from '../../adapters/notes/in-memory-note-repository.js';
import { InMemoryFactsRepository } from '../../adapters/facts/in-memory-facts-repository.js';
import { InMemoryExtractionLogRepository } from '../../adapters/logs/in-memory-extraction-log-repository.js';
import { StubEmbedder } from '../../adapters/embedding/stub.js';
import type { ModelClient } from '../../ports/model.js';

const CERTIFIED = 'claude-sonnet-5';
const EXTRACTION = JSON.stringify({
  summary: 'Sarah moved to Meridian Capital.',
  promises: [{ text: 'update her record', owner: 'rep', due_date: null, due_raw: null, confidence: 'high' }],
  people: [], personal_facts: [], key_dates: [], concerns: [], next_steps: [], meeting: null,
});
const model = (text: string): ModelClient => ({ complete: async () => ({ text }) });

async function harness() {
  const clients = new InMemoryClientRepository();
  const notes = new InMemoryNoteRepository();
  const facts = new InMemoryFactsRepository();
  const logs = new InMemoryExtractionLogRepository();
  const embedder = new StubEmbedder(8);
  const extraction = new ExtractionService(model(EXTRACTION), clients, notes, facts, embedder, logs, CERTIFIED);
  const capture = new AskCaptureService({ notes, clients, facts, embedder, extraction, now: () => 1_000_000, ttlMs: 14 * 24 * 60 * 60 * 1000 });
  const client = await clients.create('u', 'Sarah');
  return { clients, notes, facts, logs, embedder, extraction, capture, client };
}

describe('[ASK-CAPTURE] certified-path capture, held out of the vault until confirmed', () => {
  it('capture creates a pending note via the CERTIFIED engine, invisible to the vault', async () => {
    const h = await harness();
    const before = (await h.clients.findByIdForUser('u', h.client.id))!.lastTouchedAt;
    const pending = await h.capture.capture('u', h.client.id, 'Sarah moved to Meridian Capital', '2026-07-09');
    expect(pending?.statement).toBe('Sarah moved to Meridian Capital'); // the receipt = verbatim
    const note = await h.notes.findByIdForUser('u', pending!.noteId);
    expect(note?.status).toBe('pending_confirmation');
    expect(note?.source).toBe('ask_conversation');
    // CERTIFIED path: a training-log row, stamped with the certified model + prompt version.
    const log = await h.logs.listByUser('u');
    expect(log).toHaveLength(1);
    expect(log[0]!.model).toBe(CERTIFIED);
    expect(log[0]!.promptVersion).toBe(PROMPT_VERSION);
    // NOT in the vault: no embedding (→ recall can't retrieve it), no spine promise, client not touched.
    expect(await h.notes.searchSimilarByUser('u', [1, 0, 0, 0, 0, 0, 0, 0], 5)).toHaveLength(0);
    expect(await h.facts.listPromisesByUser('u')).toHaveLength(0);
    expect((await h.clients.findByIdForUser('u', h.client.id))!.lastTouchedAt).toBe(before); // not touched
  });

  it('confirm commits into the vault: searchable, spine promise, client touched', async () => {
    const h = await harness();
    const pending = await h.capture.capture('u', h.client.id, 'Sarah moved to Meridian Capital', '2026-07-09');
    expect(await h.capture.confirm('u', pending!.noteId)).toBe(true);
    const note = await h.notes.findByIdForUser('u', pending!.noteId);
    expect(note?.status).toBe('extracted');
    expect(await h.notes.searchSimilarByUser('u', [1, 0, 0, 0, 0, 0, 0, 0], 5)).toHaveLength(1); // now retrievable
    expect(await h.facts.listPromisesByUser('u')).toHaveLength(1); // now on the spine
  });

  it('reject deletes the pending note but the training-log row SURVIVES (distillation signal)', async () => {
    const h = await harness();
    const pending = await h.capture.capture('u', h.client.id, 'Sarah moved', '2026-07-09');
    expect(await h.capture.reject('u', pending!.noteId)).toBe(true);
    expect(await h.notes.findByIdForUser('u', pending!.noteId)).toBeNull(); // note gone
    expect(await h.logs.listByUser('u')).toHaveLength(1); // log stays
    expect(await h.facts.listPromisesByUser('u')).toHaveLength(0); // nothing reached the vault
  });

  it('pending captures older than the TTL auto-expire (removed like a reject)', async () => {
    const h = await harness(); // service clock fixed at now = 1_000_000
    const p = await h.capture.capture('u', h.client.id, 'Sarah moved', '2026-07-09');
    // age the pending note past the 14-day TTL relative to the service clock
    const note = await h.notes.findByIdForUser('u', p!.noteId);
    (note as { createdAt: number }).createdAt = 1_000_000 - 15 * 24 * 60 * 60 * 1000;
    expect(await h.capture.expire('u')).toBe(1);
    expect(await h.capture.listPending('u')).toHaveLength(0);
  });

  it('listPending returns the receipt (verbatim statement + client) for confirmation', async () => {
    const h = await harness();
    await h.capture.capture('u', h.client.id, 'Sarah moved to Meridian Capital', '2026-07-09');
    const queue = await h.capture.listPending('u');
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ clientName: 'Sarah', statement: 'Sarah moved to Meridian Capital' });
  });

  it('a pending note is excluded from listByClient — the choke point for brief/corpus/Monday/BookScan/detail', async () => {
    const h = await harness();
    const p = await h.capture.capture('u', h.client.id, 'Sarah moved', '2026-07-09');
    expect(await h.notes.listByClient('u', h.client.id)).toHaveLength(0); // held out of every list-based surface
    expect(await h.notes.searchSimilarByUser('u', [1, 0, 0, 0, 0, 0, 0, 0], 5)).toHaveLength(0); // and recall
    await h.capture.confirm('u', p!.noteId);
    expect(await h.notes.listByClient('u', h.client.id)).toHaveLength(1); // appears once confirmed
  });

  it('capture against an unknown client stores nothing', async () => {
    const h = await harness();
    expect(await h.capture.capture('u', 'no-such-client', 'x moved', '2026-07-09')).toBeNull();
    expect(await h.notes.listByStatusForUser('u', 'pending_confirmation')).toHaveLength(0);
  });
});
