import { describe, it, expect, vi } from 'vitest';
import { HotLeadSyncService } from './hot-lead-sync.js';
import { ExpleeError, type ExpleeApi } from '../../adapters/leads/explee-client.js';
import { InMemoryHotLeadsStore } from '../../adapters/leads/in-memory-hot-leads-store.js';
import type { ExpleeHotLead, ExpleeHotLeadsPage } from '../../ports/hot-leads.js';
import type { EmailMessage } from '../../ports/email.js';

/**
 * [P45-3 · owner] Every 10 minutes: fetch hot leads since the cursor (the newest became_hot_at saved), 200 a page,
 * dedupe on (person_id, campaign_id), save, then move the cursor. First run: the last 30 days. 429 → stop this run;
 * 402 → "Explee credit is out"; 401 → "Explee key rejected"; 5xx → retry once, then stop. No model calls.
 */
const NOW = Date.parse('2026-10-26T12:00:00Z');
const KEY = 'xk_live_SECRETKEYVALUE_1234567890';
const lead = (n: number, hot: string, o: Partial<ExpleeHotLead> = {}): ExpleeHotLead => ({ person_id: `p${n}`, campaign_id: 7, name: `Lead ${n}`, email: `lead${n}@x.io`, job_title: 'Head of Sales', company_name: 'Acme', country: 'AE', why_hot: 'Yes, send me details', became_hot_at: hot, ...o });

function api(pages: Array<ExpleeHotLeadsPage | ExpleeError>, opts: { campaigns?: ExpleeError } = {}) {
  const calls: Array<{ since: string | null; offset: number; limit: number }> = [];
  let i = 0;
  const a: ExpleeApi = {
    hotLeads: vi.fn(async (q) => { calls.push({ since: q.since, offset: q.offset, limit: q.limit }); const p = pages[Math.min(i++, pages.length - 1)]!; if (p instanceof ExpleeError) throw p; return p; }),
    campaigns: vi.fn(async () => { if (opts.campaigns) throw opts.campaigns; return [{ id: 7, project_id: 1, name: 'Dubai insurance brokers', status: 'outreach' }]; }),
  };
  return { a, calls };
}
function setup(pages: Array<ExpleeHotLeadsPage | ExpleeError>, o: { key?: string | null; campaigns?: ExpleeError; now?: number } = {}) {
  const store = new InMemoryHotLeadsStore();
  const sent: EmailMessage[] = [];
  const logs: string[] = [];
  const { a, calls } = api(pages, { campaigns: o.campaigns });
  const svc = new HotLeadSyncService({
    api: a, store, apiKeyConfigured: o.key === undefined ? true : Boolean(o.key), adminEmails: ['wabil@tovira.io'], appBaseUrl: 'https://tovira.io',
    email: { send: async (m) => { sent.push(m); } }, log: (m) => logs.push(m), now: () => o.now ?? NOW, sleep: async () => {},
  });
  return { svc, store, sent, logs, calls };
}
const page = (leads: ExpleeHotLead[], more = false, next: number | null = null): ExpleeHotLeadsPage => ({ leads, total: leads.length, has_more: more, next_offset: next });

describe('[P45-3] the hot-leads sync', () => {
  it('first run: the last 30 days; each lead gets its campaign name; the cursor is the newest became_hot_at', async () => {
    const { svc, store, calls } = setup([page([lead(1, '2026-10-26T10:00:00Z'), lead(2, '2026-10-25T09:00:00Z')])]);
    await svc.run();
    expect(calls[0]).toEqual({ since: '2026-09-26T12:00:00.000Z', offset: 0, limit: 200 });
    expect((await store.list({})).map((l) => [l.name, l.campaignName, l.status])).toEqual([['Lead 1', 'Dubai insurance brokers', 'new'], ['Lead 2', 'Dubai insurance brokers', 'new']]);
    expect((await store.getState()).cursor).toBe(Date.parse('2026-10-26T10:00:00Z'));
  });

  it('pages with limit 200 / offset until the last page', async () => {
    const { svc, store, calls } = setup([page([lead(1, '2026-10-26T10:00:00Z')], true, 200), page([lead(2, '2026-10-26T09:00:00Z')], true, 400), page([lead(3, '2026-10-26T08:00:00Z')])]);
    await svc.run();
    expect(calls.map((c) => c.offset)).toEqual([0, 200, 400]);
    expect(await store.list({})).toHaveLength(3);
  });

  it('the at-or-after overlap at `since` never duplicates; status and notes are kept', async () => {
    const s = setup([page([lead(1, '2026-10-26T10:00:00Z')]), page([lead(1, '2026-10-26T10:00:00Z'), lead(2, '2026-10-26T11:00:00Z')])]);
    await s.svc.run();
    const first = (await s.store.list({}))[0]!;
    await s.store.update(first.id, { status: 'contacted', notes: 'called' }, NOW);
    await s.svc.run();
    expect(s.calls[1]!.since).toBe('2026-10-26T10:00:00.000Z'); // since = the cursor (at-or-after)
    const all = await s.store.list({});
    expect(all).toHaveLength(2);
    expect(all.find((l) => l.personId === 'p1')).toMatchObject({ status: 'contacted', notes: 'called' });
  });

  it('the cursor moves only after the whole batch is saved (a failed save leaves it)', async () => {
    const s = setup([page([lead(1, '2026-10-26T10:00:00Z')])]);
    s.store.saveBatch = async () => { throw new Error('db down'); };
    await expect(s.svc.run()).resolves.toMatchObject({ status: 'save_failed' });
    expect((await s.store.getState()).cursor).toBeNull();
  });

  // [P46-6c.4 · owner] "keeps nothing" now means the lead's row is gone; only a tombstone (person_id + campaign_id) stays
  it('an erased lead keeps nothing of the person', async () => {
    const s = setup([page([lead(1, '2026-10-26T10:00:00Z')]), page([{ person_id: 'p1', campaign_id: 7, erased: true, became_hot_at: '2026-10-26T10:00:00Z' }])]);
    await s.svc.run(); await s.svc.run();
    expect(await s.store.list({})).toEqual([]);
    expect([...s.store.tombstones]).toEqual([{ personId: 'p1', campaignId: 7 }]);
  });

  // [P46-6c.4] Owner: a lead we wiped is never re-imported by a later poll (the at-or-after overlap, or Explee sending an
  // older copy). A tombstone keeps person_id + campaign_id only, no personal fields.
  it('NEGATIVE: a wiped lead returned again (not erased) by a later poll is never re-imported', async () => {
    const s = setup([
      page([lead(1, '2026-10-26T10:00:00Z')]),
      page([{ person_id: 'p1', campaign_id: 7, erased: true, became_hot_at: '2026-10-26T10:00:00Z' }]),
      page([lead(1, '2026-10-26T10:00:00Z')]),
    ]);
    await s.svc.run(); await s.svc.run(); await s.svc.run();
    expect(await s.store.list({})).toEqual([]);
  });

  it('NEGATIVE: a lead erased before we ever saw it is never imported later either', async () => {
    const s = setup([page([{ person_id: 'p9', campaign_id: 7, erased: true, became_hot_at: '2026-10-26T10:00:00Z' }]), page([lead(9, '2026-10-26T09:00:00Z')])]);
    await s.svc.run(); await s.svc.run();
    expect(await s.store.list({})).toEqual([]);
    expect([...s.store.tombstones]).toEqual([{ personId: 'p9', campaignId: 7 }]);
  });

  it('the tombstone is per campaign: the same person hot in another campaign is a new lead', async () => {
    const s = setup([page([{ person_id: 'p1', campaign_id: 7, erased: true, became_hot_at: '2026-10-26T10:00:00Z' }]), page([lead(1, '2026-10-26T11:00:00Z', { campaign_id: 8 })])]);
    await s.svc.run(); await s.svc.run();
    expect((await s.store.list({})).map((l) => [l.personId, l.campaignId])).toEqual([['p1', 8]]);
  });

  it('429: stop this run, the cursor stays', async () => {
    const { svc, store } = setup([new ExpleeError(429, 'rate limited')]);
    expect(await svc.run()).toMatchObject({ status: 'rate_limited' });
    expect((await store.getState())).toMatchObject({ cursor: null, lastStatus: 'rate_limited', banner: null });
  });

  it('402: logged, and the console banner says the credit is out', async () => {
    const { svc, store, logs } = setup([new ExpleeError(402, 'no credit')]);
    await svc.run();
    expect((await store.getState()).banner).toBe('Explee credit is out');
    expect(logs.join('\n')).toMatch(/402/);
  });

  it('401: the banner says the key was rejected; a good run clears it', async () => {
    const s = setup([new ExpleeError(401, 'bad key'), page([lead(1, '2026-10-26T10:00:00Z')])]);
    await s.svc.run();
    expect((await s.store.getState()).banner).toBe('Explee key rejected');
    await s.svc.run();
    expect((await s.store.getState())).toMatchObject({ banner: null, lastStatus: 'ok' });
  });

  it('5xx/504: retried once, then this run stops (the next run tries again)', async () => {
    const twice = setup([new ExpleeError(504, 'timeout'), new ExpleeError(500, 'boom')]);
    expect(await twice.svc.run()).toMatchObject({ status: 'unavailable' });
    expect(twice.calls).toHaveLength(2);
    const once = setup([new ExpleeError(503, 'blip'), page([lead(1, '2026-10-26T10:00:00Z')])]);
    expect(await once.svc.run()).toMatchObject({ status: 'ok', saved: 1 });
  });

  it('no key: "Explee key not configured", logged once per run, nothing called', async () => {
    const { svc, logs, calls } = setup([], { key: null });
    await svc.run();
    expect(logs.filter((l) => l.includes('Explee key not configured'))).toHaveLength(1);
    expect(calls).toEqual([]);
  });

  it('NEGATIVE: the key never appears in the logs, whatever happens', async () => {
    const all: string[] = [];
    for (const p of [[page([lead(1, '2026-10-26T10:00:00Z')])], [new ExpleeError(401, `invalid key ${KEY}`)], [new ExpleeError(402, 'x')], [new ExpleeError(500, 'x'), new ExpleeError(500, 'x')]]) {
      const s = setup(p as never);
      await s.svc.run();
      all.push(...s.logs);
    }
    expect(all.join('\n')).not.toContain(KEY);
    expect(all.join('\n')).not.toContain('SECRETKEYVALUE');
  });
});

describe('[P45-3] new-lead email to the admin', () => {
  it('one new lead → one email: "New hot lead: <name>, <job title> at <company>" with their reply and a link', async () => {
    const { svc, sent } = setup([page([lead(1, '2026-10-26T10:00:00Z')])]);
    await svc.run();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: 'wabil@tovira.io', subject: 'New hot lead: Lead 1, Head of Sales at Acme' });
    expect(sent[0]!.text).toContain('Yes, send me details');
    expect(sent[0]!.text).toMatch(/https:\/\/tovira\.io\/admin\/leads\?id=/);
  });
  it('several in one run → one digest; a lead already seen → no email', async () => {
    const s = setup([page([lead(1, '2026-10-26T10:00:00Z'), lead(2, '2026-10-26T09:00:00Z')]), page([lead(1, '2026-10-26T10:00:00Z')])]);
    await s.svc.run();
    expect(s.sent).toHaveLength(1);
    expect(s.sent[0]!.subject).toBe('2 new hot leads');
    await s.svc.run();
    expect(s.sent).toHaveLength(1);
  });
});
