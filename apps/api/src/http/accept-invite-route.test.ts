import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';
import { TERMS_VERSION, PRIVACY_VERSION } from '../services/legal/versions.js';
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
    // Assert against the version constants so a legitimate Terms/Privacy bump never silently drifts
    // this test (it reports the versions a new account is accepting).
    expect(body.termsVersion).toBe(TERMS_VERSION);
    expect(body.privacyVersion).toBe(PRIVACY_VERSION);
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

describe('[BETA-8] POST /auth/invite/resend (expired-link recovery)', () => {
  const lastTokenTo = (email: string): string => {
    const m = deps.emailSender.to(email).at(-1)!;
    return /\/invite\?token=([^\s)]+)/.exec(m.text)![1]!;
  };

  it('resends a NEW working link to the ORIGINAL address; the old link is invalidated; identical ok response', async () => {
    const oldToken = await seedInvite();
    const before = deps.emailSender.to('invitee@x.ae').length;

    const res = await req('POST', '/auth/invite/resend', { token: oldToken });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    // A new invite email went to the ORIGINAL invited address (not any page-supplied one).
    expect(deps.emailSender.to('invitee@x.ae').length).toBe(before + 1);
    const newToken = lastTokenTo('invitee@x.ae');
    expect(newToken).not.toBe(oldToken);

    // The new link validates; the old link is dead.
    expect((await (await req('GET', `/auth/invite?token=${encodeURIComponent(newToken)}`)).json() as { valid: boolean }).valid).toBe(true);
    expect((await (await req('GET', `/auth/invite?token=${encodeURIComponent(oldToken)}`)).json() as { valid: boolean }).valid).toBe(false);
  });

  it('an address supplied in the body is IGNORED — the link still goes only to the original address', async () => {
    const oldToken = await seedInvite();
    const before = deps.emailSender.to('invitee@x.ae').length;
    const res = await req('POST', '/auth/invite/resend', { token: oldToken, email: 'attacker@evil.test' });
    expect(res.status).toBe(200);
    expect(deps.emailSender.to('attacker@evil.test').length).toBe(0); // nothing to the attacker
    expect(deps.emailSender.to('invitee@x.ae').length).toBe(before + 1); // to the original only
  });

  it('an unknown token returns the SAME ok response and sends nothing (anti-enumeration)', async () => {
    const res = await req('POST', '/auth/invite/resend', { token: 'not-a-real-token' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(deps.emailSender.to('invitee@x.ae').length).toBe(0);
  });

  it('an already-accepted invite does not resend (same ok response, nothing sent)', async () => {
    const token = await seedInvite();
    expect((await req('POST', '/auth/accept-invite', { token, password: 'password123', acceptTerms: true })).status).toBe(200);
    const before = deps.emailSender.to('invitee@x.ae').length;
    const res = await req('POST', '/auth/invite/resend', { token });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(deps.emailSender.to('invitee@x.ae').length).toBe(before); // nothing new
  });

  it('rate limit: a 4th resend within 24h is refused (429); nothing more is sent', async () => {
    let token = await seedInvite();
    for (let i = 0; i < 3; i++) {
      expect((await req('POST', '/auth/invite/resend', { token })).status).toBe(200);
      token = lastTokenTo('invitee@x.ae');
    }
    const sent = deps.emailSender.to('invitee@x.ae').length;
    const res = await req('POST', '/auth/invite/resend', { token });
    expect(res.status).toBe(429);
    expect(deps.emailSender.to('invitee@x.ae').length).toBe(sent); // nothing more sent
  });
});
