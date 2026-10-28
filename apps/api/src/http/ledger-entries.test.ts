import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';
import { listenForTest } from '../test-support/listen.js';

/**
 * [P46-5] Owner: the Ledger is "the record of what Tovira helped you win". An entry exists ONLY where a recorded link
 * joins something Tovira did to an outcome the rep marked: today, a share made from Tovira's suggestion that the rep
 * marked bought. Each entry says what Tovira did (the suggestion, with the client's words as its receipt), what
 * happened (marked bought, when), and the deal value the rep enters on that entry. Never an inferred credit.
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

async function signup(email: string): Promise<{ token: string; userId: string }> {
  const b = (await (await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'password123' }) })).json()) as { token: string; user: { id: string } };
  return { token: b.token, userId: b.user.id };
}
const H = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });

async function suggestedSale(token: string, userId: string, clientName = 'Sara Khan') {
  const client = await deps.clients.create(userId, clientName);
  const item = (await (await fetch(`${base}/inventory`, { method: 'POST', headers: H(token), body: JSON.stringify({ title: 'Premium plan', description: 'motor and medical', quantity: null }) })).json()) as { id: string };
  const [req] = await deps.requirements.saveForNote(userId, 'note-1', client.id, [{ text: 'Cover for the family', requirementRaw: 'we need cover for the whole family', statedOn: '2026-10-10', confidence: 'high', embedding: [1, 0, 0] }]);
  const match = await deps.inventoryMatches.upsert(userId, { requirementId: req!.id, itemId: item.id, clientId: client.id, similarity: 1, confidence: 'strong' });
  const share = ((await (await fetch(`${base}/inventory/matches/${match.id}/share`, { method: 'POST', headers: H(token) })).json()) as { share: { id: string } }).share;
  await fetch(`${base}/inventory/shares/${share.id}`, { method: 'PATCH', headers: H(token), body: JSON.stringify({ outcome: 'bought' }) });
  return { clientId: client.id, itemId: item.id, matchId: match.id, shareId: share.id };
}
type Entry = { id: string; clientId: string; clientName: string; itemTitle: string; suggestedAt: number; receipt: { quote: string; statedOn: string | null; noteId: string } | null; outcome: string; outcomeAt: number; dealValueAed: number | null };
const entries = async (t: string) => ((await (await fetch(`${base}/ledger`, { headers: H(t) })).json()) as { entries: Entry[] }).entries;

describe('[P46-5] Ledger entries', () => {
  it('a suggestion the rep acted on and marked bought is one entry: the client, what Tovira suggested with its receipt, and the sale', async () => {
    const { token, userId } = await signup('le1@example.com');
    const s = await suggestedSale(token, userId);
    const [e, ...rest] = await entries(token);
    expect(rest).toEqual([]);
    expect(e).toMatchObject({ clientId: s.clientId, clientName: 'Sara Khan', itemTitle: 'Premium plan', outcome: 'bought', dealValueAed: null, receipt: { quote: 'we need cover for the whole family', statedOn: '2026-10-10', noteId: 'note-1' } });
    expect(typeof e!.suggestedAt).toBe('number');
    expect(e!.outcomeAt).toBeGreaterThanOrEqual(e!.suggestedAt);
  });

  it('NEGATIVE: an independent share marked bought is not an entry (Tovira did not suggest it)', async () => {
    const { token, userId } = await signup('le2@example.com');
    const client = await deps.clients.create(userId, 'Omar');
    const item = (await (await fetch(`${base}/inventory`, { method: 'POST', headers: H(token), body: JSON.stringify({ title: 'Q3 proposal', description: 'retainer', quantity: null }) })).json()) as { id: string };
    const share = (await (await fetch(`${base}/inventory/${item.id}/shares`, { method: 'POST', headers: H(token), body: JSON.stringify({ clientId: client.id }) })).json()) as { id: string };
    await fetch(`${base}/inventory/shares/${share.id}`, { method: 'PATCH', headers: H(token), body: JSON.stringify({ outcome: 'bought' }) });
    expect(await entries(token)).toEqual([]);
  });

  it('NEGATIVE: a kept promise, a brief before a meeting, a re-engaged thread are not entries (no outcome the rep marked)', async () => {
    const { token, userId } = await signup('le3@example.com');
    const client = await deps.clients.create(userId, 'Layla');
    for (const type of ['promise_kept', 'brief_before_meeting', 'thread_reopened'] as const) {
      await deps.ledger.record(userId, { type, clientId: client.id, sourceId: `${type}-1`, dedupeKey: `${type}-1`, occurredAt: Date.now() });
    }
    expect(await entries(token)).toEqual([]);
  });

  it('the deal value is entered on the entry, cleared with null, and refused when negative', async () => {
    const { token, userId } = await signup('le4@example.com');
    await suggestedSale(token, userId);
    const [e] = await entries(token);
    const put = (aed: unknown) => fetch(`${base}/ledger/entries/${e!.id}/deal-value`, { method: 'PUT', headers: H(token), body: JSON.stringify({ aed }) });
    expect((await put(12500)).status).toBe(200);
    expect((await entries(token))[0]!.dealValueAed).toBe(12500);
    expect((await put(-1)).status).toBe(400);
    expect((await put('lots')).status).toBe(400);
    expect((await put(null)).status).toBe(200);
    expect((await entries(token))[0]!.dealValueAed).toBeNull();
  });

  it('NEGATIVE: another rep cannot read or set my entry (404)', async () => {
    const a = await signup('le5a@example.com');
    const b = await signup('le5b@example.com');
    await suggestedSale(a.token, a.userId);
    const [e] = await entries(a.token);
    expect(await entries(b.token)).toEqual([]);
    expect((await fetch(`${base}/ledger/entries/${e!.id}/deal-value`, { method: 'PUT', headers: H(b.token), body: JSON.stringify({ aed: 1 }) })).status).toBe(404);
  });

  it('NEGATIVE: an entry about a client under an erasure restriction is withheld', async () => {
    const { token, userId } = await signup('le6@example.com');
    await suggestedSale(token, userId, 'Khalid Restricted');
    expect(await entries(token)).toHaveLength(1);
    await deps.erasureRequests.create(userId, { requesterNames: ['Khalid Restricted'], requestedAt: Date.now(), windowEndsAt: Date.now() + 10 * DAY });
    expect(await entries(token)).toEqual([]);
  });

  it('a share made from a suggestion remembers which suggestion (its receipt is exact)', async () => {
    const { token, userId } = await signup('le7@example.com');
    const s = await suggestedSale(token, userId);
    expect((await deps.inventoryRepo.findShareForUser(userId, s.shareId))?.matchId).toBe(s.matchId);
  });
});
