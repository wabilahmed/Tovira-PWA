import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';
import type { AccessRequestInput } from '../ports/access-request-repository.js';

const OPS = 'test-ops-token';
const REQ = (over: Partial<AccessRequestInput> = {}): AccessRequestInput => ({
  fullName: 'Dana', workEmail: 'dana@x.ae', phone: '1', companyName: 'Co', roleTitle: 'Broker',
  ownership: 'owns_or_manages', tradeLicenceNumber: 'TL-1', conversationOwnership: 'own_clients',
  conversationOwnershipOther: null, expectedVolume: 'under_50', confirmationAcceptedAt: 1, confirmationTextVersion: 'v',
  sourceIp: null, userAgent: null, referralCode: null, ...over,
});

let server: Server;
let base: string;
let deps: TestDeps;
beforeEach(async () => {
  deps = buildInMemoryDeps();
  server = createApiServer(deps);
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

const ops = (method: string, path: string, body?: unknown, token: string | null = OPS) =>
  fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { 'x-ops-token': token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });

describe('[BETA-5] /ops/access-requests', () => {
  it('is gated by the ops token (403 without it)', async () => {
    expect((await ops('GET', '/ops/access-requests', undefined, null)).status).toBe(403);
    expect((await ops('POST', '/ops/access-requests/x/approve', {}, 'wrong')).status).toBe(403);
  });

  it('lists requests and filters by status', async () => {
    await deps.accessRequests.create(REQ({ workEmail: 'a@x.ae' }));
    const b = await deps.accessRequests.create(REQ({ workEmail: 'b@x.ae' }));
    await deps.accessApproval.reject(b.id, 'no');
    const all = await (await ops('GET', '/ops/access-requests')).json() as { requests: unknown[] };
    expect(all.requests).toHaveLength(2);
    const pending = await (await ops('GET', '/ops/access-requests?status=pending')).json() as { requests: Array<{ workEmail: string }> };
    expect(pending.requests.map((r) => r.workEmail)).toEqual(['a@x.ae']);
    expect((await ops('GET', '/ops/access-requests?status=bogus')).status).toBe(400);
  });

  it('gets one request, 404 for unknown', async () => {
    const r = await deps.accessRequests.create(REQ());
    expect((await (await ops('GET', `/ops/access-requests/${r.id}`)).json() as { request: { id: string } }).request.id).toBe(r.id);
    expect((await ops('GET', '/ops/access-requests/nope')).status).toBe(404);
  });

  it('approve → 200 + invited; a second approve is 409; reject records a note', async () => {
    const r = await deps.accessRequests.create(REQ());
    const approved = await ops('POST', `/ops/access-requests/${r.id}/approve`, { reviewedBy: 'owner' });
    expect(approved.status).toBe(200);
    expect((await approved.json() as { request: { status: string } }).request.status).toBe('invited');
    expect((await ops('POST', `/ops/access-requests/${r.id}/approve`, {})).status).toBe(409); // already reviewed

    const r2 = await deps.accessRequests.create(REQ({ workEmail: 'rej@x.ae' }));
    const rejected = await ops('POST', `/ops/access-requests/${r2.id}/reject`, { note: 'not now' });
    expect((await rejected.json() as { request: { status: string; reviewedNote: string } }).request).toMatchObject({ status: 'rejected', reviewedNote: 'not now' });
  });

  describe('the account created by approval is UNUSABLE until the invite is consumed', () => {
    const post = (path: string, body: unknown) =>
      fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

    beforeEach(async () => {
      const r = await deps.accessRequests.create(REQ({ workEmail: 'pending@x.ae' }));
      await ops('POST', `/ops/access-requests/${r.id}/approve`, {});
    });

    it('cannot be logged into (login → 401)', async () => {
      for (const pw of ['', 'password123', 'anything-at-all']) {
        expect((await post('/auth/login', { email: 'pending@x.ae', password: pw })).status).toBe(401);
      }
    });

    it('cannot be reached by password reset (forgot-password answers 200 but issues NO token)', async () => {
      // The route never enumerates (always 200)…
      expect((await post('/auth/forgot-password', { email: 'pending@x.ae' })).status).toBe(200);
      // …and the guard means NO reset token is issued for an invite-pending account.
      expect(await deps.auth.createPasswordReset('pending@x.ae')).toBeNull();
    });

    it('cannot reach resend-verification (it requires a session, and the account cannot get one)', async () => {
      expect((await post('/auth/resend-verification', {})).status).toBe(401);
    });

    it('has no public route to request a new invite (invites are ops-only)', async () => {
      // No such endpoint exists — a plausible guess 404s rather than minting a second invite.
      expect((await post('/auth/resend-invite', { email: 'pending@x.ae' })).status).toBe(404);
    });
  });
});
