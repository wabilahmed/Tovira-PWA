import { describe, it, expect, vi } from 'vitest';
import { ExtractionService } from './extraction-service.js';
import { InMemoryClientRepository } from '../../adapters/clients/in-memory-client-repository.js';
import { InMemoryNoteRepository } from '../../adapters/notes/in-memory-note-repository.js';
import { InMemoryFactsRepository } from '../../adapters/facts/in-memory-facts-repository.js';
import { InMemoryExtractionLogRepository } from '../../adapters/logs/in-memory-extraction-log-repository.js';
import { InMemoryMeetingRepository } from '../../adapters/meetings/in-memory-meeting-repository.js';
import { StubEmbedder } from '../../adapters/embedding/stub.js';
import { AskCaptureService } from '../recall/ask-capture-service.js';
import type { ModelClient } from '../../ports/model.js';

/**
 * [P40-1] End to end on the write path: the stored date never comes from the model's guess.
 * "Resolver patched out" = resolveExtractionDates replaced by a no-op, so nothing is resolved and only the
 * write path's rule decides.
 */
const resolverOff = vi.hoisted(() => ({ on: false }));
vi.mock('./resolve-date.js', async (orig) => {
  const real = await orig<typeof import('./resolve-date.js')>();
  return { ...real, resolveExtractionDates: (...a: Parameters<typeof real.resolveExtractionDates>) => (resolverOff.on ? undefined : real.resolveExtractionDates(...a)) };
});

const json = (o: object) => JSON.stringify({ summary: 'x', promises: [], people: [], personal_facts: [], key_dates: [], concerns: [], next_steps: [], meeting: null, ...o });
const model = (text: string): ModelClient => ({ complete: async () => ({ text }) });

async function setup(text: string, note: { source: 'paste' | 'whatsapp_export'; rawText: string; messages?: unknown[] }) {
  const clients = new InMemoryClientRepository();
  const notes = new InMemoryNoteRepository();
  const facts = new InMemoryFactsRepository();
  const meetings = new InMemoryMeetingRepository();
  const c = await clients.create('u', 'Sara Khan');
  const n = await notes.create('u', { clientId: c.id, source: note.source, rawText: note.rawText, audioKey: null, status: 'pending_extraction', ...(note.messages ? { messages: note.messages } : {}) } as never);
  const service = new ExtractionService(model(text), clients, notes, facts, new StubEmbedder(8), new InMemoryExtractionLogRepository(), 'stub',
    undefined, undefined, undefined, undefined, meetings);
  return { service, notes, facts, meetings, clients, c, n };
}

const SUNDAY = json({ promises: [{ text: 'Send the floor plans', owner: 'rep', due_date: '2026-10-20', due_raw: 'Sunday morning', confidence: 'high', source_span: "Sure, I'll send them Sunday morning", source_message_at: '2026-10-10T10:05' }] });
const CHAT = { source: 'whatsapp_export' as const, rawText: "10/10/2026, 10:05 - Wabil: Sure, I'll send them Sunday morning", messages: [{ sender: 'Wabil', sentAt: '2026-10-10T10:05', body: "Sure, I'll send them Sunday morning", media: false, role: 'rep' }] };

// the receipt post-check keeps a span only when it is really in the chat, so the chat carries the sentence
const DEPOSIT = { source: 'whatsapp_export' as const, rawText: '10/04/2026, 09:00 - Sara: I will pay the deposit on 25/04/2026', messages: [{ sender: 'Sara', sentAt: '2026-04-10T09:00', body: 'I will pay the deposit on 25/04/2026', media: false, role: 'client' }] };

describe('[P40-1] the write path never stores the model\'s guessed date', () => {
  it('"Sunday morning" with the resolver patched out → stored null, phrase kept, date to confirm', async () => {
    resolverOff.on = true;
    try {
      const { service, facts, n } = await setup(SUNDAY, CHAT);
      await service.extractNote('u', n.id, '2026-10-21');
      const [p] = await facts.listPromisesByNote('u', n.id);
      expect(p!.dueDate).toBeNull();
      expect(p!.dueRaw).toBe('Sunday morning');
      expect(p!.dateStatus).toBe('to_confirm');
    } finally { resolverOff.on = false; }
  });

  it('with the resolver on, the same message stores Sunday 11 Oct and nothing to confirm', async () => {
    const { service, facts, n } = await setup(SUNDAY, CHAT);
    await service.extractNote('u', n.id, '2026-10-21');
    const [p] = await facts.listPromisesByNote('u', n.id);
    expect(p!.dueDate).toBe('2026-10-11');
    expect(p!.dateStatus).toBeNull();
  });

  it('an explicit "25/04/2026" in the quote keeps the model\'s date even with the resolver off', async () => {
    resolverOff.on = true;
    try {
      const { service, facts, n } = await setup(json({ promises: [{ text: 'Pay the deposit', owner: 'client', due_date: '2026-04-25', due_raw: 'by the 25th', confidence: 'high', source_span: 'I will pay the deposit on 25/04/2026', source_message_at: '2026-04-10T09:00' }] }), DEPOSIT);
      await service.extractNote('u', n.id, '2026-04-21');
      const [p] = await facts.listPromisesByNote('u', n.id);
      expect(p!.dueDate).toBe('2026-04-25');
      expect(p!.dateStatus).toBeNull();
    } finally { resolverOff.on = false; }
  });

  it('a voice/paste note anchors "Friday" to the note\'s own date (deterministic), not the model', async () => {
    // note reference date 2026-07-09 (a Thursday) → Friday = 2026-07-10; the model says 2026-07-17 (wrong week)
    const { service, facts, n } = await setup(json({ promises: [{ text: 'Send the revised quote', owner: 'rep', due_date: '2026-07-17', due_raw: 'Friday', confidence: 'high' }] }), { source: 'paste', rawText: "I'll send the revised quote by Friday" });
    await service.extractNote('u', n.id, '2026-07-09');
    const [p] = await facts.listPromisesByNote('u', n.id);
    expect(p!.dueDate).toBe('2026-07-10');
  });

  it('a meeting the resolver can\'t read is stored without a time (never the model\'s)', async () => {
    resolverOff.on = true;
    try {
      const { service, meetings, n } = await setup(json({ meeting: { datetime: '2026-10-14T15:00', datetime_raw: 'next Tuesday 3pm', confirmed: false } }), CHAT);
      await service.extractNote('u', n.id, '2026-10-10');
      const [m] = await meetings.listByUser('u');
      expect(m!.datetime).toBeNull();
      expect(m!.datetimeRaw).toBe('next Tuesday 3pm');
    } finally { resolverOff.on = false; }
  });

  it('a held "Add a note" commits with the same rule when confirmed (it used to commit the model\'s due_date)', async () => {
    resolverOff.on = true;
    try {
      const { service, notes, facts, clients, c } = await setup(SUNDAY, CHAT);
      const capture = new AskCaptureService({ notes, clients, facts, embedder: new StubEmbedder(8), extraction: service, now: () => 1, ttlMs: 14 * 86_400_000 });
      const held = await capture.capture('u', c.id, "I'll send Sara the floor plans Sunday morning", '2026-10-10');
      await capture.confirm('u', held!.noteId);
      const [p] = await facts.listPromisesByNote('u', held!.noteId);
      expect(p!.dueDate).toBeNull();
      expect(p!.dateStatus).toBe('to_confirm');
    } finally { resolverOff.on = false; }
  });
});

describe('[P40-1 · owner] a meeting with no time from the resolver is marked to confirm', () => {
  it('extraction stores it with dateStatus "to_confirm"', async () => {
    resolverOff.on = true;
    try {
      const { service, meetings, n } = await setup(json({ meeting: { datetime: '2026-10-14T15:00', datetime_raw: 'Saturday afternoon', confirmed: false } }), CHAT);
      await service.extractNote('u', n.id, '2026-10-10');
      const [m] = await meetings.listByUser('u');
      expect(m!.datetime).toBeNull();
      expect(m!.dateStatus).toBe('to_confirm');
    } finally { resolverOff.on = false; }
  });
});
