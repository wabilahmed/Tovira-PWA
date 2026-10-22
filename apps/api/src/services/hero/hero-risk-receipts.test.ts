import { describe, it, expect } from 'vitest';
import { HeroService } from './hero-service.js';
import { InMemoryClientRepository } from '../../adapters/clients/in-memory-client-repository.js';
import { InMemoryFactsRepository } from '../../adapters/facts/in-memory-facts-repository.js';
import { InMemoryMeetingRepository } from '../../adapters/meetings/in-memory-meeting-repository.js';
import { InMemoryNoteRepository } from '../../adapters/notes/in-memory-note-repository.js';

/**
 * [P39-5] "Deals at risk": each reason carries its own receipt (the message it rests on), so Today can show the
 * reason with the evidence and HIDE a reason that has none. Silence → the client's last message to the rep.
 * Missed promise(s) → the oldest missed promise's own words. "No decision-maker" is an absence: no message
 * proves it, so its receipt is null (never a made-up quote).
 */
const NOW = Date.parse('2026-07-09T12:00:00Z');
const DAY = 86_400_000;

function make() {
  const clients = new InMemoryClientRepository();
  const facts = new InMemoryFactsRepository();
  const meetings = new InMemoryMeetingRepository();
  const notes = new InMemoryNoteRepository();
  return { clients, facts, notes, hero: new HeroService({ clients, facts, meetings, notes }, { minClients: 1, minNotes: 0 }, 30, 90) };
}

describe('[P39-5] risk reasons carry receipts', () => {
  it('silence → the last client message; missed promise → its own words; no decision-maker → null', async () => {
    const ctx = make();
    const c = await ctx.clients.create('u', 'Sara Khan');
    (c as { lastTouchedAt: number }).lastTouchedAt = NOW - 45 * DAY;
    const n = await ctx.notes.create('u', { clientId: c.id, source: 'whatsapp_export', rawText: 'x', audioKey: null, status: 'extracted', messages: [
      { sender: 'Sara', sentAt: '2026-05-20T09:00', body: 'Let me think about the Mirdif one', media: false, role: 'client' },
      { sender: 'Sara', sentAt: '2026-05-25T10:30', body: 'I will send the ID photos tomorrow', media: false, role: 'client' },
    ] } as never);
    await ctx.facts.saveExtraction('u', { noteId: n.id, clientId: c.id, promises: [
      { text: 'Send the ID photos', owner: 'client', due_date: '2026-07-01', due_raw: 'tomorrow', confidence: 'high', source_span: 'I will send the ID photos tomorrow', source_message_at: '2026-05-25T10:30' },
    ] });
    const [risk] = await ctx.hero.risk('u', NOW);
    expect(risk!.name).toBe('Sara Khan');
    expect(risk!.details).toEqual([
      { reason: 'No contact in 45 days', receipt: { quote: 'I will send the ID photos tomorrow', source: 'message', at: '2026-05-25T10:30', noteId: n.id } },
      { reason: '1 missed promise', receipt: { quote: 'I will send the ID photos tomorrow', source: 'message', at: '2026-05-25T10:30', noteId: n.id } },
      { reason: 'No decision-maker contact yet', receipt: null },
    ]);
    expect(risk!.reasons).toEqual(['No contact in 45 days', '1 missed promise', 'No decision-maker contact yet']); // unchanged
  });

  it('negative: silence with no client message on file has no receipt (not a last-contact date dressed as one)', async () => {
    const ctx = make();
    const c = await ctx.clients.create('u', 'Quiet Co');
    (c as { lastTouchedAt: number }).lastTouchedAt = NOW - 45 * DAY;
    await ctx.notes.create('u', { clientId: c.id, source: 'voice', rawText: 'x', audioKey: null, status: 'extracted' });
    const [risk] = await ctx.hero.risk('u', NOW);
    expect(risk!.details.every((d) => d.receipt === null)).toBe(true);
  });

  it('negative: a missed promise with no saved words has no receipt', async () => {
    const ctx = make();
    const c = await ctx.clients.create('u', 'No Span');
    (c as { lastTouchedAt: number }).lastTouchedAt = NOW - 45 * DAY;
    const n = await ctx.notes.create('u', { clientId: c.id, source: 'voice', rawText: 'x', audioKey: null, status: 'extracted' });
    await ctx.facts.saveExtraction('u', { noteId: n.id, clientId: c.id, promises: [
      { text: 'Call back', owner: 'rep', due_date: '2026-07-01', due_raw: null, confidence: 'high' },
    ] });
    const [risk] = await ctx.hero.risk('u', NOW);
    expect(risk!.details.find((d) => d.reason === '1 missed promise')!.receipt).toBeNull();
  });
});

describe('[P39-5] a promise on Today carries its due date (for the Overdue / Due today / Due Thu badge)', () => {
  it('dueDate is the promise\'s surfaced due date; other kinds have none', async () => {
    const ctx = make();
    const c = await ctx.clients.create('u', 'C');
    await ctx.facts.saveExtraction('u', { noteId: 'n', clientId: c.id, promises: [
      { text: 'overdue thing', owner: 'rep', due_date: '2026-07-01', due_raw: '', confidence: 'high' },
      { text: 'due thing', owner: 'rep', due_date: '2026-07-10', due_raw: '', confidence: 'high' },
    ] });
    const quiet = await ctx.clients.create('u', 'Quiet');
    (quiet as { lastTouchedAt: number }).lastTouchedAt = NOW - 45 * DAY;
    const actions = await ctx.hero.today('u', NOW);
    expect(actions.filter((a) => a.kind === 'promise').map((a) => [a.title, a.dueDate])).toEqual([['overdue thing', '2026-07-01'], ['due thing', '2026-07-10']]);
    expect(actions.find((a) => a.kind === 'cold')!.dueDate).toBeUndefined();
  });
});
