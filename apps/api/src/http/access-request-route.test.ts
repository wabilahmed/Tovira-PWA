import { describe, it, expect, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';
import { FixedWindowRateLimiter } from '../services/security/rate-limiter.js';
import type { ApiDeps } from '../server.js';

const VALID = {
  fullName: 'Dana Rep',
  workEmail: 'dana@brokerage.ae',
  phone: '+971 50 123 4567',
  companyName: 'Meridian Real Estate',
  roleTitle: 'Senior Broker',
  ownership: 'owns_or_manages',
  tradeLicenceNumber: 'TL-998877',
  conversationOwnership: 'brokerage_i_manage',
  expectedVolume: '50_200',
  confirmationAccepted: true,
};

let server: Server | null = null;
async function start(overrides: Partial<ApiDeps> = {}): Promise<{ base: string; deps: TestDeps }> {
  const deps = buildInMemoryDeps(overrides);
  server = createApiServer(deps);
  await new Promise<void>((r) => server!.listen(0, r));
  const { port } = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}`, deps };
}
afterEach(async () => {
  if (server) await new Promise<void>((r) => server!.close(() => r()));
  server = null;
});
const post = (base: string, body: unknown) =>
  fetch(`${base}/access-request`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('[BETA-3] POST /access-request', () => {
  it('accepts a valid submission (201), persists the row, and notifies the owner', async () => {
    const notified: string[] = [];
    const { base, deps } = await start({ accessRequestNotify: async (rec) => { notified.push(rec.id); } });
    const res = await post(base, VALID);
    expect(res.status).toBe(201);
    const json = (await res.json()) as { ok: boolean; id: string };
    expect(json.ok).toBe(true);
    expect(await deps.accessRequests.count()).toBe(1);
    expect(notified).toEqual([json.id]); // notification carried the created row
  });

  it('persists the row and still returns success when the notification email THROWS', async () => {
    const { base, deps } = await start({ accessRequestNotify: async () => { throw new Error('mail is down'); } });
    const res = await post(base, VALID);
    expect(res.status).toBe(201); // the write does not depend on the email
    expect(await deps.accessRequests.count()).toBe(1); // row persisted despite the mail failure
  });

  it('rejects an invalid submission with 400 + the offending field, and writes nothing', async () => {
    const { base, deps } = await start();
    const res = await post(base, { ...VALID, workEmail: 'nope' });
    expect(res.status).toBe(400);
    expect((await res.json() as { field: string }).field).toBe('workEmail');
    expect(await deps.accessRequests.count()).toBe(0);
  });

  it('silently drops a honeypot hit (bot filled the hidden field): fake 200, no row, no notification', async () => {
    const notified: string[] = [];
    const { base, deps } = await start({ accessRequestNotify: async (rec) => { notified.push(rec.id); } });
    const res = await post(base, { ...VALID, company_url: 'http://spam.example' });
    expect(res.status).toBe(200);
    expect(await deps.accessRequests.count()).toBe(0);
    expect(notified).toEqual([]);
  });

  it('rate-limits by IP counting EVERY request, not only failures (unlike the login limiter)', async () => {
    // A submit endpoint has no "failed vs succeeded" to key on — every well-formed request succeeds.
    const { base, deps } = await start({ accessRequestLimiter: new FixedWindowRateLimiter(3, 60_000) });
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) codes.push((await post(base, VALID)).status);
    expect(codes.slice(0, 3)).toEqual([201, 201, 201]); // three successful submissions counted
    expect(codes[3]).toBe(429); // the fourth is throttled — proves successes are counted
    expect(await deps.accessRequests.count()).toBe(3);
  });
});
