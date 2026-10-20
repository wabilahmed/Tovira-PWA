import { describe, it, expect } from 'vitest';
import { buildBook, NOW, U } from '../../test-support/ask-book.fixture.js';
import { ClientOverviewService } from './client-overview.js';
import { summarizeRequirements } from './requirement-summary.js';

/**
 * [P36-5] The client page reads one deterministic overview (no model): the header line (last message, open +
 * overdue promises), "What they want" built from the STORED requirements (type, area, budget with its history,
 * deadline), promises open-first with whose they are, the next meeting, each conversation as its own entry, and
 * — only as a suggestion — the status the existing going-cold / lost-inferred logic would infer.
 */
const DAY = 86_400_000;
async function overview(opts: Parameters<typeof buildBook>[0] = {}) {
  const b = await buildBook(opts);
  const svc = new ClientOverviewService({ ...b.repos, coldThresholdDays: 30 });
  return { b, svc };
}

describe('[P36-5] what they want — from the stored requirements', () => {
  it('QA Windowed Buyer 2 → "4BR villa · Mirdif · up to 3.4M", budget history 3M → 3.4M', async () => {
    const { b, svc } = await overview();
    const o = (await svc.forClient(U, b.ids.windowed, NOW))!;
    expect(o.wants.summary).toBe('4BR villa · Mirdif · up to 3.4M');
    expect(o.wants.listLine).toBe('4BR villa · Mirdif · 3.4M');
    expect(o.wants.budgets).toEqual(['3M', '3.4M']);
    expect(o.wants.items.map((i) => i.text)).toEqual(['4BR villa in Mirdif', 'Updated budget of 3.4M']);
  });

  it('a deadline in a requirement shows as "decide by …"', () => {
    const s = summarizeRequirements([{ text: 'Villa in Mirdif, budget 3M', requirementRaw: 'need to decide by 30 Jun', statedOn: '2026-05-01', createdAt: 1 }]);
    expect(s.summary).toBe('villa · Mirdif · up to 3M · decide by 30 Jun');
  });

  it('no requirements → nothing to summarise (the page says "Nothing yet")', async () => {
    const { b, svc } = await overview();
    const o = (await svc.forClient(U, b.ids.quiet, NOW))!;
    expect(o.wants.summary).toBeNull();
    expect(o.wants.items).toEqual([]);
  });
});

describe('[P36-5] header, promises, conversations', () => {
  it('last message + open/overdue promise counts, whose promise it is', async () => {
    const { b, svc } = await overview();
    const o = (await svc.forClient(U, b.ids.windowed, NOW))!;
    expect(o.lastMessageAt).toBe('2026-10-16T08:30');
    expect(o.openPromises).toBe(1);
    expect(o.overduePromises).toBe(1);
    expect(o.promises[0]).toMatchObject({ text: 'send the ID document photos', owner: 'client', done: false, overdue: true });
  });

  it('done promises come after open ones', async () => {
    const { b, svc } = await overview();
    const all = await b.repos.facts.listPromisesByUser(U);
    const gate = all.find((p) => p.clientId === b.ids.gate)!;
    await b.repos.facts.saveExtraction(U, { noteId: gate.noteId, clientId: b.ids.gate, captureAt: '2026-10-15', promises: [
      { text: 'send the floor plans', owner: 'rep', due_date: '2026-10-18', due_raw: 'by Saturday', confidence: 'high', source_span: "I'll send the floor plans by Saturday", source_message_at: '2026-10-14T09:00' },
      { text: 'share the brochure', owner: 'rep', due_date: null, due_raw: null, confidence: 'high', source_span: "I'll share the brochure", source_message_at: '2026-10-14T09:01' },
    ] });
    const brochure = (await b.repos.facts.listPromisesByUser(U)).find((p) => p.text === 'share the brochure')!;
    await b.repos.facts.markPromiseDone(U, brochure.id);
    const o = (await svc.forClient(U, b.ids.gate, NOW))!;
    expect(o.promises.map((p) => [p.text, p.done])).toEqual([['send the floor plans', false], ['share the brochure', true]]);
  });

  it('each imported chat is one conversation entry: kind, message count, date — never raw lines', async () => {
    const { b, svc } = await overview();
    const o = (await svc.forClient(U, b.ids.windowed, NOW))!;
    expect(o.conversations).toHaveLength(1);
    expect(o.conversations[0]).toMatchObject({ kind: 'whatsapp', messageCount: 3, lastAt: '2026-10-16T08:30' });
    expect(JSON.stringify(o.conversations)).not.toMatch(/WHATSAPP_EXPORT|whatsapp_export|\] .*:/);
  });

  it('an unknown / other rep\'s client → null', async () => {
    const { svc } = await overview();
    expect(await svc.forClient(U, 'nope', NOW)).toBeNull();
    expect(await svc.forClient('someone-else', 'nope', NOW)).toBeNull();
  });
});

describe('[P36-7] an inferred status is only ever a suggestion', () => {
  it('silent past the going-cold threshold → suggests Cold; the status itself is unchanged', async () => {
    const { b, svc } = await overview();
    const later = Date.now() + 40 * DAY;
    const o = (await svc.forClient(U, b.ids.quiet, later))!;
    expect(o.statusSuggestion).toMatchObject({ status: 'cold' });
    expect(o.statusSuggestion!.reason).toMatch(/^No reply in \d+ days\.$/);
    expect((await b.repos.clients.findByIdForUser(U, b.ids.quiet))!.leadStatus).toBeNull();
  });

  it('lost_inferred → suggests Done (Lost); never sets it', async () => {
    const { b, svc } = await overview();
    await b.repos.clients.setOutcome(U, b.ids.quiet, 'lost_inferred', 'inferred', NOW);
    const o = (await svc.forClient(U, b.ids.quiet, NOW))!;
    expect(o.statusSuggestion).toMatchObject({ status: 'done', outcome: 'lost' });
    const c = (await b.repos.clients.findByIdForUser(U, b.ids.quiet))!;
    expect(c.leadStatus).toBeNull();
  });

  it('NEGATIVE: an active client, or one the rep already marked, gets no suggestion', async () => {
    const { b, svc } = await overview();
    expect((await svc.forClient(U, b.ids.quiet, NOW))!.statusSuggestion).toBeNull();
    await b.repos.clients.setLeadStatus(U, b.ids.quiet, 'cold', NOW);
    expect((await svc.forClient(U, b.ids.quiet, Date.now() + 40 * DAY))!.statusSuggestion).toBeNull();
  });
});
