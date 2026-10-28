import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';
import { listenForTest } from '../test-support/listen.js';

/**
 * [P47-1] The Ledger shows a client the rep set to Won after Tovira's suggestion: "Tovira suggested <item>", its receipt,
 * "You marked them Won". A suggestion that was also marked bought and then Won is ONE card with both facts.
 */
let server: Server;
let base: string;
let deps: TestDeps;
const DAY = 86_400_000;
beforeAll(async () => {
  deps = buildInMemoryDeps();
  server = createApiServer(deps);
  await listenForTest(server);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

async function signup(email: string) {
  const b = (await (await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'password123' }) })).json()) as { token: string; user: { id: string } };
  return { H: { authorization: `Bearer ${b.token}`, 'content-type': 'application/json' }, userId: b.user.id };
}
async function suggestionShare(r: { H: Record<string, string>; userId: string }, clientName = 'Sara Khan') {
  const client = await deps.clients.create(r.userId, clientName);
  const item = (await (await fetch(`${base}/inventory`, { method: 'POST', headers: r.H, body: JSON.stringify({ title: 'Premium plan', description: 'motor and medical', quantity: null }) })).json()) as { id: string };
  const [req] = await deps.requirements.saveForNote(r.userId, 'note-1', client.id, [{ text: 'Cover for the family', requirementRaw: 'we need cover for the whole family', statedOn: '2026-10-10', confidence: 'high', embedding: [1, 0, 0] }]);
  const match = await deps.inventoryMatches.upsert(r.userId, { requirementId: req!.id, itemId: item.id, clientId: client.id, similarity: 1, confidence: 'strong' });
  const share = ((await (await fetch(`${base}/inventory/matches/${match.id}/share`, { method: 'POST', headers: r.H })).json()) as { share: { id: string } }).share;
  return { clientId: client.id, shareId: share.id };
}
const outcome = (r: { H: Record<string, string> }, clientId: string, o: string) => fetch(`${base}/clients/${clientId}/outcome`, { method: 'POST', headers: r.H, body: JSON.stringify({ outcome: o }) });
type Entry = { id: string; clientName: string; itemTitle: string; boughtAt: number | null; wonAt: number | null; receipt: { quote: string } | null; outcomeAt: number };
const entries = async (r: { H: Record<string, string> }) => ((await (await fetch(`${base}/ledger`, { headers: r.H })).json()) as { entries: Entry[] }).entries;

describe('[P47-1] Won after a suggestion, through the API', () => {
  it('the rep sets Won → a deal on the Ledger: the suggestion with its receipt, and the Won', async () => {
    const r = await signup('w1@example.com');
    const s = await suggestionShare(r);
    expect((await outcome(r, s.clientId, 'won')).status).toBe(200);
    const [e, ...rest] = await entries(r);
    expect(rest).toEqual([]);
    expect(e).toMatchObject({ clientName: 'Sara Khan', itemTitle: 'Premium plan', boughtAt: null, receipt: { quote: 'we need cover for the whole family' } });
    expect(e!.wonAt).toEqual(expect.any(Number));
  });

  it('undoing Won (back to open) removes the entry', async () => {
    const r = await signup('w2@example.com');
    const s = await suggestionShare(r);
    await outcome(r, s.clientId, 'won');
    await outcome(r, s.clientId, 'open');
    expect(await entries(r)).toEqual([]);
  });

  it('marked bought and then Won → ONE card with both facts', async () => {
    const r = await signup('w3@example.com');
    const s = await suggestionShare(r);
    await fetch(`${base}/inventory/shares/${s.shareId}`, { method: 'PATCH', headers: r.H, body: JSON.stringify({ outcome: 'bought' }) });
    await outcome(r, s.clientId, 'won');
    const list = await entries(r);
    expect(list).toHaveLength(1);
    expect(list[0]!.boughtAt).toEqual(expect.any(Number));
    expect(list[0]!.wonAt).toEqual(expect.any(Number));
  });

  it('NEGATIVE: Won for a client with no suggestion share → nothing on the Ledger', async () => {
    const r = await signup('w4@example.com');
    const client = await deps.clients.create(r.userId, 'Omar');
    await outcome(r, client.id, 'won');
    expect(await entries(r)).toEqual([]);
  });

  it('NEGATIVE: a client under an erasure restriction is withheld', async () => {
    const r = await signup('w5@example.com');
    const s = await suggestionShare(r, 'Khalid Restricted');
    await outcome(r, s.clientId, 'won');
    expect(await entries(r)).toHaveLength(1);
    await deps.erasureRequests.create(r.userId, { requesterNames: ['Khalid Restricted'], requestedAt: Date.now(), windowEndsAt: Date.now() + 10 * DAY });
    expect(await entries(r)).toEqual([]);
  });
});

// [P47-3] Owner: the Ledger shows only what Tovira helped the rep win. "Kept after a reminder" and "Answered after Book
// Scan" were rejected; a kept promise, a brief before a meeting and a re-engaged thread note stay stored, shown nowhere.
describe('[P47-3] the Ledger renders only the approved kinds', () => {
  it('NEGATIVE: promise_kept, brief_before_meeting and thread_reopened events never become an entry', async () => {
    const r = await signup('w6@example.com');
    const client = await deps.clients.create(r.userId, 'Layla');
    for (const type of ['promise_kept', 'brief_before_meeting', 'thread_reopened'] as const) {
      await deps.ledger.record(r.userId, { type, clientId: client.id, sourceId: `${type}-1`, dedupeKey: `${type}-1`, occurredAt: Date.now() });
    }
    const body = (await (await fetch(`${base}/ledger`, { headers: r.H })).json()) as { entries: unknown[]; winBacks?: unknown[] };
    expect(body.entries).toEqual([]);
    expect(body.winBacks ?? []).toEqual([]);
  });

  it('the only kinds an entry can come from are: suggestion shared and marked bought, Won after a suggestion, re-engaged after an alert', async () => {
    const { LEDGER_ENTRY_KINDS } = await import('../services/ledger/ledger-entries.js');
    expect([...LEDGER_ENTRY_KINDS].sort()).toEqual(['inventory_suggested_bought', 'reengaged_after_alert', 'won_after_suggestion']);
  });
});
