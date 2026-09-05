import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';

let server: Server;
let base: string;
let deps: TestDeps;

beforeAll(async () => {
  deps = buildInMemoryDeps();
  server = createApiServer(deps);
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

async function signup(email: string): Promise<{ token: string; userId: string }> {
  const res = await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'password123' }) });
  const b = (await res.json()) as { token: string; user: { id: string } };
  return { token: b.token, userId: b.user.id };
}
const authed = (token: string) => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' });

/** Seed a client, an item, an open requirement, and a strong match between them. Returns their ids. */
async function seedMatch(token: string, userId: string) {
  const client = await deps.clients.create(userId, 'Ahmed');
  const item = (await (await fetch(`${base}/inventory`, { method: 'POST', headers: authed(token), body: JSON.stringify({ title: 'Marina Heights 402', description: '2-bed near the marina', quantity: 1 }) })).json()) as { id: string };
  const [req] = await deps.requirements.saveForNote(userId, 'note-1', client.id, [{ text: 'A 2-bed near the marina', requirementRaw: 'looking for a 2-bed near the marina', statedOn: '2026-03-14', confidence: 'high', embedding: [1, 0, 0] }]);
  const match = await deps.inventoryMatches.upsert(userId, { requirementId: req!.id, itemId: item.id, clientId: client.id, similarity: 1, confidence: 'strong' });
  return { clientId: client.id, itemId: item.id, requirementId: req!.id, matchId: match.id };
}

describe('[INV-MATCH] surfacing API (A5)', () => {
  it('GET /inventory/matches returns strong suggestions with receipts + the badge count', async () => {
    const { token, userId } = await signup('m-list@example.com');
    await seedMatch(token, userId);
    const body = (await (await fetch(`${base}/inventory/matches`, { headers: authed(token) })).json()) as { suggestions: Array<{ confidence: string; receipt: { requirementRaw: string; noteId: string }; itemTitle: string }>; badge: number };
    expect(body.suggestions).toHaveLength(1);
    expect(body.suggestions[0]!.confidence).toBe('strong');
    expect(body.suggestions[0]!.receipt.requirementRaw).toContain('marina');
    expect(body.suggestions[0]!.receipt.noteId).toBe('note-1');
    expect(JSON.stringify(body.suggestions[0])).not.toMatch(/similarity/); // no number surfaced
    expect(body.badge).toBe(1);
  });

  it('GET /inventory/:id/matches returns the reverse direction (clients who asked)', async () => {
    const { token, userId } = await signup('m-rev@example.com');
    const { itemId } = await seedMatch(token, userId);
    const body = (await (await fetch(`${base}/inventory/${itemId}/matches`, { headers: authed(token) })).json()) as { suggestions: unknown[] };
    expect(body.suggestions).toHaveLength(1);
  });

  it('POST /inventory/matches/:id/dismiss removes it from every surface', async () => {
    const { token, userId } = await signup('m-dismiss@example.com');
    const { matchId, itemId } = await seedMatch(token, userId);
    expect((await fetch(`${base}/inventory/matches/${matchId}/dismiss`, { method: 'POST', headers: authed(token) })).status).toBe(200);
    expect(((await (await fetch(`${base}/inventory/matches`, { headers: authed(token) })).json()) as { suggestions: unknown[]; badge: number }).badge).toBe(0);
    expect(((await (await fetch(`${base}/inventory/${itemId}/matches`, { headers: authed(token) })).json()) as { suggestions: unknown[] }).suggestions).toHaveLength(0);
  });

  it('POST /inventory/matches/seen clears the badge', async () => {
    const { token, userId } = await signup('m-seen@example.com');
    await seedMatch(token, userId);
    await fetch(`${base}/inventory/matches/seen`, { method: 'POST', headers: authed(token) });
    expect(((await (await fetch(`${base}/inventory/matches`, { headers: authed(token) })).json()) as { badge: number }).badge).toBe(0);
  });

  // The ledger-honesty path: acting on a suggestion → a confirmed_suggestion share → credited on
  // bought. An independent share of the same item credits nothing.
  it('share-from-suggestion is credited on bought; an independent share is not', async () => {
    const { token, userId } = await signup('m-ledger@example.com');
    const { matchId, itemId, clientId } = await seedMatch(token, userId);

    // Act on the suggestion → a confirmed_suggestion share.
    const shareRes = await fetch(`${base}/inventory/matches/${matchId}/share`, { method: 'POST', headers: authed(token) });
    expect(shareRes.status).toBe(200);
    const share = ((await shareRes.json()) as { share: { id: string; outcomeSetBy: string } }).share;
    expect(share.outcomeSetBy).toBe('confirmed_suggestion');
    // Mark it bought → the ledger credit fires.
    await fetch(`${base}/inventory/shares/${share.id}`, { method: 'PATCH', headers: authed(token), body: JSON.stringify({ outcome: 'bought', quantityBought: 1 }) });
    expect((await deps.ledger.summary(userId)).byType.inventory_suggested_bought ?? 0).toBeGreaterThanOrEqual(1);

    // An INDEPENDENT share of the same item to the same client, marked bought → NO extra credit.
    const before = (await deps.ledger.summary(userId)).byType.inventory_suggested_bought ?? 0;
    const indep = ((await (await fetch(`${base}/inventory/${itemId}/shares`, { method: 'POST', headers: authed(token), body: JSON.stringify({ clientId }) })).json()) as { id: string });
    await fetch(`${base}/inventory/shares/${indep.id}`, { method: 'PATCH', headers: authed(token), body: JSON.stringify({ outcome: 'bought', quantityBought: 1 }) });
    expect((await deps.ledger.summary(userId)).byType.inventory_suggested_bought ?? 0).toBe(before);

    // And acting on the suggestion dismissed it — it no longer surfaces.
    expect(((await (await fetch(`${base}/inventory/matches`, { headers: authed(token) })).json()) as { suggestions: unknown[] }).suggestions).toHaveLength(0);
  });
});
