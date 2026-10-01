import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';
import type { AccessRequestInput } from '../ports/access-request-repository.js';

const REQ = (over: Partial<AccessRequestInput> = {}): AccessRequestInput => ({
  fullName: 'Dana', workEmail: 'invitee@x.ae', phone: '1', companyName: 'Co', roleTitle: 'Broker',
  ownership: 'owns_or_manages', tradeLicenceNumber: 'TL', conversationOwnership: 'own_clients',
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
afterEach(async () => { await new Promise<void>((r) => server.close(() => r())); });

const req = (method: string, path: string, body?: unknown) =>
  fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

/** Approve a seeded request and pull the raw invite token out of the invite email. */
async function seedInvite(): Promise<string> {
  const r = await deps.accessRequests.create(REQ());
  await deps.accessApproval.approve(r.id, { createdBy: 'ops' });
  const email = deps.emailSender.to('invitee@x.ae').at(-1)!;
  return /\/invite\?token=([^\s)]+)/.exec(email.text)![1]!;
}

describe('[BETA-6] invite acceptance routes', () => {
  it('GET /auth/invite reports validity (without consuming) + the versions being accepted', async () => {
    const token = await seedInvite();
    const res = await req('GET', `/auth/invite?token=${encodeURIComponent(token)}`);
    const body = await res.json() as { valid: boolean; termsVersion: string; privacyVersion: string };
    expect(body.valid).toBe(true);
    expect(body.termsVersion).toBe('2026-09-22');
    expect(body.privacyVersion).toBe('2026-09-22');
    // peeking did not consume it
    expect((await (await req('GET', `/auth/invite?token=${encodeURIComponent(token)}`)).json() as { valid: boolean }).valid).toBe(true);
    expect((await req('GET', '/auth/invite?token=bogus')).status).toBe(200);
    expect((await (await req('GET', '/auth/invite?token=bogus')).json() as { valid: boolean }).valid).toBe(false);
  });

  it('POST /auth/accept-invite requires the terms box (400 terms_required)', async () => {
    const token = await seedInvite();
    const res = await req('POST', '/auth/accept-invite', { token, password: 'password123', acceptTerms: false });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toBe('terms_required');
  });

  it('POST /auth/accept-invite activates the account, then the SAME link is rejected, and login now works', async () => {
    const token = await seedInvite();
    expect((await req('POST', '/auth/accept-invite', { token, password: 'password123', acceptTerms: true })).status).toBe(200);
    // single-use: the link no longer works
    expect((await req('POST', '/auth/accept-invite', { token, password: 'password123', acceptTerms: true })).status).toBe(400);
    // the account is now active: login succeeds with the chosen password
    expect((await req('POST', '/auth/login', { email: 'invitee@x.ae', password: 'password123' })).status).toBe(200);
  });

  it('POST /auth/accept-invite rejects a bad token (400) and a short password (400)', async () => {
    expect((await req('POST', '/auth/accept-invite', { token: 'nope', password: 'password123', acceptTerms: true })).status).toBe(400);
    const token = await seedInvite();
    expect((await req('POST', '/auth/accept-invite', { token, password: 'short', acceptTerms: true })).status).toBe(400);
  });
});
