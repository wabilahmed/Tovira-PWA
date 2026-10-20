import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';

/**
 * [P36-7 · owner, 20 Oct] Undo restores the EXACT previous status — the status with its original changed-at,
 * the outcome with its original source and time — and never resets the going-quiet clock (last_touched_at).
 * ("Still open" — POST outcome 'open' — is a different action: it deliberately resets the clock.)
 */
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
const post = (token: string, path: string, body: unknown) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) });

describe('[P36-7] Undo of Done (lost)', () => {
  it('gives back the original status and the original clock', async () => {
    const { token, userId } = await signup('undo@example.com');
    const c = await deps.clients.create(userId, 'QA Enter Key Client');
    const touched = Date.parse('2026-09-01T10:00:00Z');
    const warmAt = Date.parse('2026-09-05T10:00:00Z');
    await deps.clients.setLastTouched(userId, c.id, touched);
    await deps.clients.setLeadStatus(userId, c.id, 'warm', warmAt);
    const before = { ...(await deps.clients.findByIdForUser(userId, c.id))! }; // the snapshot the page holds

    expect((await post(token, `/clients/${c.id}/lead-status`, { status: 'done' })).status).toBe(200);
    expect((await post(token, `/clients/${c.id}/outcome`, { outcome: 'lost' })).status).toBe(200);
    // Undo, with the snapshot the page held:
    expect((await post(token, `/clients/${c.id}/lead-status`, { status: 'warm', restoreChangedAt: before.leadStatusChangedAt })).status).toBe(200);
    expect((await post(token, `/clients/${c.id}/outcome`, { outcome: 'restore', previous: { outcome: before.outcome, source: before.outcomeSource, changedAt: before.outcomeChangedAt } })).status).toBe(200);

    const after = (await deps.clients.findByIdForUser(userId, c.id))!;
    expect(after.leadStatus).toBe('warm');
    expect(after.leadStatusChangedAt).toBe(warmAt);
    expect(after.outcome).toBe('open');
    expect(after.outcomeSource).toBe(before.outcomeSource);
    expect(after.outcomeChangedAt).toBe(before.outcomeChangedAt);
    expect(after.lastTouchedAt).toBe(touched); // the going-quiet clock is untouched
  });

  it('restores an inferred loss as it was (source and time)', async () => {
    const { token, userId } = await signup('undo2@example.com');
    const c = await deps.clients.create(userId, 'Quiet Client');
    const inferredAt = Date.parse('2026-08-01T00:00:00Z');
    await deps.clients.setOutcome(userId, c.id, 'lost_inferred', 'inferred', inferredAt);
    await post(token, `/clients/${c.id}/outcome`, { outcome: 'won' });
    await post(token, `/clients/${c.id}/outcome`, { outcome: 'restore', previous: { outcome: 'lost_inferred', source: 'inferred', changedAt: inferredAt } });
    const after = (await deps.clients.findByIdForUser(userId, c.id))!;
    expect([after.outcome, after.outcomeSource, after.outcomeChangedAt]).toEqual(['lost_inferred', 'inferred', inferredAt]);
  });

  it('NEGATIVE: a malformed restore is refused and changes nothing', async () => {
    const { token, userId } = await signup('undo3@example.com');
    const c = await deps.clients.create(userId, 'Client');
    expect((await post(token, `/clients/${c.id}/outcome`, { outcome: 'restore', previous: { outcome: 'bogus', source: 'rep', changedAt: 1 } })).status).toBe(400);
    expect((await post(token, `/clients/${c.id}/outcome`, { outcome: 'restore', previous: { outcome: 'won', source: 'rep', changedAt: Date.now() + 86_400_000 } })).status).toBe(400);
    expect((await post(token, `/clients/${c.id}/lead-status`, { status: 'warm', restoreChangedAt: 'yesterday' })).status).toBe(400);
    expect((await deps.clients.findByIdForUser(userId, c.id))!.outcome).toBe('open');
  });
});
