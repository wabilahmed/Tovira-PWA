import { describe, it, expect } from 'vitest';
import type { RequirementRecord } from '../../ports/requirement-repository.js';
import { caresAbout } from '../clients/cares-about.js';
import { BriefService } from '../brief/brief-service.js';
import { NudgeSignalsProvider } from '../scheduler/nudge-signals.js';
import { composeNudgeContent } from '../scheduler/nudge-content.js';
import { StructuredRecall } from '../recall/structured-recall.js';
import { MatchingService } from '../inventory/matching-service.js';
import { InMemoryClientRepository } from '../../adapters/clients/in-memory-client-repository.js';
import { InMemoryFactsRepository } from '../../adapters/facts/in-memory-facts-repository.js';
import { InMemoryNoteRepository } from '../../adapters/notes/in-memory-note-repository.js';
import { InMemoryMeetingRepository } from '../../adapters/meetings/in-memory-meeting-repository.js';
import { InMemoryInventoryMatchRepository } from '../../adapters/inventory/in-memory-inventory-match-repository.js';
import { InMemoryRequirementRepository } from '../../adapters/requirements/in-memory-requirement-repository.js';
import { InMemoryInventoryRepository } from '../../adapters/inventory/in-memory-inventory-repository.js';
import type { Embedder } from '../../ports/embedder.js';
import { buildBook, NOW as BOOK_NOW, U as BOOK_U } from '../../test-support/ask-book.fixture.js';

/**
 * [P84-7 · owner, 22 Nov] "Apply supersede everywhere a requirement is shown or used: the brief, recall, nudges and
 * inventory matching." P83-8 covered the window merge, the client page, the Clients list and Find. Pinned with v1's
 * O02 ("We need at least 3 bedrooms", March) and X01 ("... so we need 4 bedrooms not 3", September). The earlier need
 * is never deleted; it is only left out wherever the current need is shown or used.
 */
const O02_RAW = 'We need at least 3 bedrooms';
const X01_RAW = "ok so update, Karim's mum is definitely moving in now so we need 4 bedrooms not 3";
const U = 'u';
const rec = (id: string, clientId: string, text: string, raw: string, statedOn: string, lastMentionedAt: number): RequirementRecord => ({
  id, userId: U, noteId: `note-${id}`, clientId, text, requirementRaw: raw, statedOn, confidence: 'high', status: 'open', embedded: true, lastMentionedAt, createdAt: 1,
});
// O02 was mentioned again more recently than X01, so a newest-first list would lead with the stale count.
const pair = (clientId: string) => [
  rec('x01', clientId, 'At least 4 bedrooms', X01_RAW, '2026-09-03', 1000),
  rec('o02', clientId, 'At least 3 bedrooms', O02_RAW, '2026-03-02', 2000),
];
const fakeEmbedder: Embedder = { embed: async () => [0, 0, 0] } as unknown as Embedder;

describe('[P84-7] what they care about (the brief, the client page, the nudges): only the latest count', () => {
  it('caresAbout lists "At least 4 bedrooms" and not "At least 3 bedrooms"', () => {
    const asks = caresAbout({ clientName: 'Karim', notes: [], requirements: pair('c1') }).filter((i) => i.kind === 'ask').map((i) => i.text);
    expect(asks).toEqual(['At least 4 bedrooms']);
  });
  it('NEGATIVE: two different needs both stay', () => {
    const reqs = [pair('c1')[1]!, rec('p', 'c1', '2 parking spaces', 'and 2 parking spaces', '2026-09-03', 3000)];
    expect(caresAbout({ clientName: 'Karim', notes: [], requirements: reqs }).map((i) => i.text).sort()).toEqual(['2 parking spaces', 'At least 3 bedrooms']);
  });
  it('the pre-meeting brief', async () => {
    const clients = new InMemoryClientRepository();
    const c = await clients.create(U, 'Karim Family');
    const brief = (await new BriefService(clients, new InMemoryNoteRepository(), new InMemoryFactsRepository(), fakeEmbedder, undefined, undefined, undefined, { listByClient: async () => pair(c.id) }).buildBrief(U, c.id))!;
    const asks = brief.caresAbout.filter((i) => i.kind === 'ask').map((i) => i.text);
    expect(asks).toEqual(['At least 4 bedrooms']);
  });
  it('the pre-meeting reminder', async () => {
    const NOW = Date.parse('2026-10-09T09:00:00Z');
    const clients = new InMemoryClientRepository();
    const meetings = new InMemoryMeetingRepository();
    const c = await clients.create(U, 'Karim Family');
    const provider = new NudgeSignalsProvider({ clients, facts: new InMemoryFactsRepository(), notes: new InMemoryNoteRepository(), timezoneFor: async () => 'Asia/Dubai', coldThresholdDays: 30, requirements: { listByClient: async () => pair(c.id) } });
    const meeting = await meetings.create(U, { clientId: c.id, datetime: new Date(NOW + 2 * 3_600_000).toISOString(), datetimeRaw: '3pm', title: null, confirmed: true });
    const body = composeNudgeContent(await provider.signalsFor(U, meeting, NOW)).body;
    expect(body).toContain('At least 4 bedrooms');
    expect(body).not.toContain('3 bedrooms');
  });
});

describe('[P84-7] recall: only the latest count is quoted', () => {
  it('structured recall (Find / Ask across clients) never quotes the replaced need', async () => {
    const clients = new InMemoryClientRepository();
    const c = await clients.create(U, 'Karim Family');
    const recall = new StructuredRecall({ facts: new InMemoryFactsRepository(), meetings: new InMemoryMeetingRepository(), clients, requirements: { listOpenByUser: async () => pair(c.id) } });
    const quotes = (await recall.forUser(U, Date.parse('2026-10-01T00:00:00Z'), { question: 'how many bedrooms does Karim need?' })).map((r) => r.quote).join(' | ');
    expect(quotes).toContain(X01_RAW);
    expect(quotes).not.toContain(O02_RAW);
  });
  it('the count and list answer ("which clients have open requirements?") lists the client by its latest need', async () => {
    const b = await buildBook();
    const c = await b.repos.clients.create(BOOK_U, 'QA Karim Family');
    const n1 = await b.repos.notes.create(BOOK_U, { clientId: c.id, source: 'whatsapp_export', rawText: O02_RAW, audioKey: null, status: 'extracted', messages: [] });
    const n2 = await b.repos.notes.create(BOOK_U, { clientId: c.id, source: 'paste', rawText: X01_RAW, audioKey: null, status: 'extracted', messages: [] });
    await b.repos.requirements.saveForNote(BOOK_U, n1.id, c.id, [{ text: 'At least 3 bedrooms', requirementRaw: O02_RAW, statedOn: '2026-03-02', confidence: 'high', embedding: null }]);
    await b.repos.requirements.saveForNote(BOOK_U, n2.id, c.id, [{ text: 'At least 4 bedrooms', requirementRaw: X01_RAW, statedOn: '2026-09-03', confidence: 'high', embedding: null }]);
    const out = await b.svc.ask(BOOK_U, 'How many clients do I have with open requirements?', BOOK_NOW);
    const karim = out.list!.items.find((i) => i.clientName === 'QA Karim Family')!;
    expect(karim.line).toBe('At least 4 bedrooms');
    expect(karim.receipts.map((r) => r.quote)).toEqual([X01_RAW]);
  });
});

describe('[P84-7] inventory matching: a replaced need is never matched or suggested', () => {
  const V = [1, 0, 0];
  async function fx() {
    const matches = new InMemoryInventoryMatchRepository();
    const requirements = new InMemoryRequirementRepository();
    const inventory = new InMemoryInventoryRepository();
    const svc = new MatchingService(matches, requirements, inventory);
    const item = await inventory.create(U, { title: 'Arabian Ranches 3BR', description: '3 bedroom villa', quantity: 1, embedding: V });
    const [o02] = await requirements.saveForNote(U, 'note-1', 'c1', [{ text: 'At least 3 bedrooms', requirementRaw: O02_RAW, statedOn: '2026-03-02', confidence: 'high', embedding: V }]);
    return { svc, requirements, item, o02: o02! };
  }
  const addX01 = async (requirements: InMemoryRequirementRepository) =>
    (await requirements.saveForNote(U, 'note-2', 'c1', [{ text: 'At least 4 bedrooms', requirementRaw: X01_RAW, statedOn: '2026-09-03', confidence: 'high', embedding: V }]))[0]!;

  it('direction 1: the replaced need matches nothing; the latest one matches', async () => {
    const { svc, requirements, o02 } = await fx();
    const x01 = await addX01(requirements);
    expect(await svc.matchRequirement(U, o02, V)).toEqual([]);
    expect(await svc.matchRequirement(U, x01, V)).toHaveLength(1);
  });
  it('direction 2: a new item matches the latest need only', async () => {
    const { svc, requirements, item } = await fx();
    const x01 = await addX01(requirements);
    const made = await svc.matchItem(U, item, V);
    expect(made.map((m) => m.requirementId)).toEqual([x01.id]);
  });
  it('a match made before the update is no longer suggested (brief, Today, Inventory, Monday)', async () => {
    const { svc, requirements, o02, item } = await fx();
    expect(await svc.matchRequirement(U, o02, V)).toHaveLength(1);
    await addX01(requirements);
    expect((await svc.suggestionsForClient(U, 'c1')).map((s) => s.receipt.requirementRaw)).not.toContain(O02_RAW);
    expect((await svc.suggestionsForItem(U, item.id)).map((s) => s.receipt.requirementRaw)).not.toContain(O02_RAW);
    expect(await svc.badgeCount(U)).toBe(0);
  });
  it('NEGATIVE: with no later count, the need still matches as before', async () => {
    const { svc, o02 } = await fx();
    expect(await svc.matchRequirement(U, o02, V)).toHaveLength(1);
    expect(await svc.suggestionsForClient(U, 'c1')).toHaveLength(1);
  });
});
