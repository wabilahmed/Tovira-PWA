/**
 * [P35] A test-rep-shaped book for the Ask count / list tests (test helper — imported only by tests; kept
 * out of services/, whose files may not import adapters).
 *  - QA P14 Gate Client      open: 2BR in JVC · budget around 1.5M · parking for two cars   (last client msg 15 Oct)
 *  - QA Windowed Buyer 2     open: 4BR villa in Mirdif · updated budget 3.4M                (last client msg 16 Oct)
 *  - QA Enter Key Client     open: 3BR townhouse in Arabian Ranches, budget 2.2M            (last client msg 1 Sep)
 *  - QA Closed Client        WON  — open: studio in Dubai Marina (must never count)          (last client msg 2 Aug)
 *  - QA Quiet Client         no requirements                                               (last client msg 20 Sep)
 * Promises (NOW = Tue 20 Oct 2026): Gate — rep, due 18 Oct (overdue) · Windowed — client-owned, due 15 Oct
 * (overdue) · Enter Key — rep, made 19 Oct ("I'll send the payment plan"), due 27 Oct.
 */
import { RecallService } from '../services/recall/recall-service.js';
import { StructuredRecall } from '../services/recall/structured-recall.js';
import { AggregateRecall } from '../services/recall/aggregate-recall.js';
import { InMemoryClientRepository } from '../adapters/clients/in-memory-client-repository.js';
import { InMemoryFactsRepository } from '../adapters/facts/in-memory-facts-repository.js';
import { InMemoryMeetingRepository } from '../adapters/meetings/in-memory-meeting-repository.js';
import { InMemoryNoteRepository } from '../adapters/notes/in-memory-note-repository.js';
import { InMemoryRequirementRepository } from '../adapters/requirements/in-memory-requirement-repository.js';
import { InMemoryRecallSessionRepository } from '../adapters/recall/in-memory-recall-session-repository.js';
import type { ModelClient } from '../ports/model.js';
import type { ImportedMessage, SimilarNote } from '../ports/note-repository.js';

export const NOW = Date.parse('2026-10-20T08:00:00Z');
export const U = 'u-agg';

const msg = (role: 'rep' | 'client', sender: string, sentAt: string, body: string): ImportedMessage => ({ sender, sentAt, body, media: false, role });

export interface Book {
  svc: RecallService;
  ids: Record<'gate' | 'windowed' | 'enterKey' | 'closed' | 'quiet', string>;
  modelCalls: () => number;
}

export async function buildBook(opts: { empty?: boolean; extraClients?: number; modelAnswer?: string; aliases?: Record<string, string[]> } = {}): Promise<Book> {
  const clients = new InMemoryClientRepository();
  const notes = new InMemoryNoteRepository();
  const requirements = new InMemoryRequirementRepository();
  const facts = new InMemoryFactsRepository();
  const meetings = new InMemoryMeetingRepository();
  const sessions = new InMemoryRecallSessionRepository();

  const mk = async (name: string, msgs: ImportedMessage[]) => {
    const c = await clients.create(U, name);
    const n = await notes.create(U, { clientId: c.id, source: 'whatsapp_export', rawText: msgs.map((m) => `[${m.sentAt}] ${m.sender}: ${m.body}`).join('\n'), audioKey: null, status: 'extracted', messages: msgs });
    return { c, n };
  };
  const gate = await mk('QA P14 Gate Client', [
    msg('client', 'Gate Buyer', '2026-04-12T10:15', 'Hi, looking for a 2BR in JVC, budget around 1.5M'),
    msg('client', 'Gate Buyer', '2026-04-12T10:16', 'We need parking for two cars'),
    msg('rep', 'Wabil', '2026-10-14T09:00', "I'll send the floor plans by Saturday"),
    msg('client', 'Gate Buyer', '2026-10-15T11:00', 'Thanks, waiting for them'),
  ]);
  const windowed = await mk('QA Windowed Buyer 2', [
    msg('client', 'Windowed Buyer', '2026-05-01T09:00', 'looking for a 4BR villa in Mirdif, budget around 3M'),
    msg('client', 'Windowed Buyer', '2026-05-16T12:00', 'our budget is now 3.4M'),
    msg('client', 'Windowed Buyer', '2026-10-16T08:30', "I'll send the ID document photos"),
  ]);
  const enterKey = await mk('QA Enter Key Client', [
    msg('client', 'Enter Key', '2026-09-01T14:00', 'A 3BR townhouse in Arabian Ranches, budget 2.2M'),
    msg('rep', 'Wabil', '2026-10-19T16:40', "I'll send the payment plan next week"),
  ]);
  const closed = await mk('QA Closed Client', [msg('client', 'Closed Co', '2026-08-02T10:00', 'Studio in Dubai Marina please')]);
  const quiet = await mk('QA Quiet Client', [msg('client', 'Quiet Person', '2026-09-20T10:00', 'Let me think about it')]);
  await clients.setOutcome(U, closed.c.id, 'won', 'rep', NOW);

  if (!opts.empty) {
    await requirements.saveForNote(U, gate.n.id, gate.c.id, [
      { text: '2BR in JVC', requirementRaw: 'looking for a 2BR in JVC', statedOn: '2026-04-12', confidence: 'high', embedding: null },
      { text: 'budget around 1.5M', requirementRaw: 'budget around 1.5M', statedOn: '2026-04-12', confidence: 'high', embedding: null },
      { text: 'parking for two cars', requirementRaw: 'We need parking for two cars', statedOn: '2026-04-12', confidence: 'high', embedding: null },
    ]);
    await requirements.saveForNote(U, windowed.n.id, windowed.c.id, [
      { text: '4BR villa in Mirdif', requirementRaw: 'looking for a 4BR villa in Mirdif, budget around 3M', statedOn: '2026-05-01', confidence: 'high', embedding: null },
      { text: 'Updated budget of 3.4M', requirementRaw: 'our budget is now 3.4M', statedOn: '2026-05-16', confidence: 'high', embedding: null },
    ]);
    await requirements.saveForNote(U, enterKey.n.id, enterKey.c.id, [
      { text: '3BR townhouse in Arabian Ranches, budget 2.2M', requirementRaw: 'A 3BR townhouse in Arabian Ranches, budget 2.2M', statedOn: '2026-09-01', confidence: 'high', embedding: null },
    ]);
    await requirements.saveForNote(U, closed.n.id, closed.c.id, [
      { text: 'Studio in Dubai Marina', requirementRaw: 'Studio in Dubai Marina please', statedOn: '2026-08-02', confidence: 'high', embedding: null },
    ]);
  }
  for (let i = 0; i < (opts.extraClients ?? 0); i++) {
    const x = await mk(`QA Extra Client ${String(i + 1).padStart(2, '0')}`, [msg('client', `Extra ${i}`, '2026-10-01T10:00', 'looking for an apartment')]);
    await requirements.saveForNote(U, x.n.id, x.c.id, [{ text: 'an apartment', requirementRaw: 'looking for an apartment', statedOn: '2026-10-01', confidence: 'high', embedding: null }]);
  }

  await facts.saveExtraction(U, { noteId: gate.n.id, clientId: gate.c.id, captureAt: '2026-10-15', promises: [
    { text: 'send the floor plans', owner: 'rep', due_date: '2026-10-18', due_raw: 'by Saturday', confidence: 'high', source_span: "I'll send the floor plans by Saturday", source_message_at: '2026-10-14T09:00' },
  ] });
  await facts.saveExtraction(U, { noteId: windowed.n.id, clientId: windowed.c.id, captureAt: '2026-10-16', promises: [
    { text: 'send the ID document photos', owner: 'client', due_date: '2026-10-15', due_raw: null, confidence: 'high', source_span: "I'll send the ID document photos", source_message_at: '2026-10-16T08:30' },
  ] });
  await facts.saveExtraction(U, { noteId: enterKey.n.id, clientId: enterKey.c.id, captureAt: '2026-10-19', promises: [
    { text: 'send the payment plan', owner: 'rep', due_date: '2026-10-27', due_raw: 'next week', confidence: 'high', source_span: "I'll send the payment plan next week", source_message_at: '2026-10-19T16:40' },
  ] });

  let calls = 0;
  const model: ModelClient = { complete: async () => { calls += 1; return { text: opts.modelAnswer ?? "I don't have that on record." }; } };
  const noVector = { searchSimilarByUser: async (): Promise<SimilarNote[]> => [] } as never;
  const dir = async (userId: string) => (await clients.listByUser(userId)).map((c) => ({ id: c.id, name: c.name, aliases: opts.aliases?.[c.name] ?? [] }));
  const structured = new StructuredRecall({ facts, meetings, clients, requirements, notes });
  const aggregate = new AggregateRecall({ clients, requirements, facts, notes });
  const svc = new RecallService(
    { dimension: 8, embed: async () => [1, 0, 0, 0, 0, 0, 0, 0] }, noVector, model, undefined, undefined, 'stub',
    sessions, undefined, undefined, dir, undefined, undefined, structured, aggregate,
  );
  return { svc, ids: { gate: gate.c.id, windowed: windowed.c.id, enterKey: enterKey.c.id, closed: closed.c.id, quiet: quiet.c.id }, modelCalls: () => calls };
}
