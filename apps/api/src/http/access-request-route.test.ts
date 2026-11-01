import { describe, it, expect, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';
import { FixedWindowRateLimiter } from '../services/security/rate-limiter.js';
import type { ApiDeps } from '../server.js';
import { listenForTest } from '../test-support/listen.js';

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
  // [P42 · owner] Industry is required on new requests.
  industry: 'property',
  confirmationAccepted: true,
};

let server: Server | null = null;
async function start(overrides: Partial<ApiDeps> = {}): Promise<{ base: string; deps: TestDeps }> {
  const deps = buildInMemoryDeps(overrides);
  server = createApiServer(deps);
  await listenForTest(server!);
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

  it('[P42-A6] NEGATIVE: a submission without an industry is 400 on the industry field, and writes nothing', async () => {
    const { base, deps } = await start();
    const rest: Record<string, unknown> = { ...VALID };
    delete rest.industry;
    const res = await post(base, rest);
    expect(res.status).toBe(400);
    expect((await res.json() as { field: string }).field).toBe('industry');
    expect(await deps.accessRequests.count()).toBe(0);
  });

  it('rejects an invalid submission with 400 + the offending field, and writes nothing', async () => {
    const { base, deps } = await start();
    const res = await post(base, { ...VALID, workEmail: 'nope' });
    expect(res.status).toBe(400);
    expect((await res.json() as { field: string }).field).toBe('workEmail');
    expect(await deps.accessRequests.count()).toBe(0);
  });

  // [P63-2 · owner] the trap was "company_url", a name Chrome's autofill can fill with the person's company (so a real
  // request could vanish behind a fake "Thank you"); it is "hp_trap_7" now, and every hit is logged (a count, no content)
  it('silently drops a honeypot hit (bot filled the hidden field): fake 200, no row, no notification; logged', async () => {
    const notified: string[] = [];
    const { base, deps } = await start({ accessRequestNotify: async (rec) => { notified.push(rec.id); } });
    const logs: string[] = [];
    const orig = console.info;
    console.info = (...a: unknown[]) => { logs.push(a.map(String).join(' ')); };
    try {
      const res = await post(base, { ...VALID, hp_trap_7: 'http://spam.example' });
      expect(res.status).toBe(200);
    } finally { console.info = orig; }
    expect(await deps.accessRequests.count()).toBe(0);
    expect(notified).toEqual([]);
    expect(logs.some((l) => l.includes('[access-request] honeypot hit'))).toBe(true);
    expect(logs.join('\n')).not.toContain('spam.example'); // a count, never the content
  });

  it('[P63-2] NEGATIVE: the old trap name, autofilled by a browser on an old copy of the form, no longer drops a real request', async () => {
    const { base, deps } = await start();
    const res = await post(base, { ...VALID, company_url: 'Meridian Real Estate' });
    expect(res.status).toBe(201);
    expect(await deps.accessRequests.count()).toBe(1);
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

  // [P63-3 · owner] A person correcting the form (each attempt refused with a validation message) was spending the same
  // 5-per-hour budget, shared with the invite prefill: a few corrections, or a few colleagues behind one office network,
  // and they were locked out for an hour. Now a refused validation doesn't count, the prefill has its own limit, and the
  // cap on real submissions (and on spam: trap hits and malformed bodies) stays.
  it('[P63-3] a refused validation does not count: five corrections, then the request goes through', async () => {
    const { base, deps } = await start({ accessRequestLimiter: new FixedWindowRateLimiter(3, 60_000) });
    for (let i = 0; i < 5; i++) expect((await post(base, { ...VALID, workEmail: 'nope' })).status).toBe(400);
    expect((await post(base, VALID)).status).toBe(201);
    expect(await deps.accessRequests.count()).toBe(1);
  });
  it('[P63-3] NEGATIVE: spam still counts: trap hits and malformed bodies spend the budget', async () => {
    const { base } = await start({ accessRequestLimiter: new FixedWindowRateLimiter(3, 60_000) });
    expect((await post(base, { ...VALID, hp_trap_7: 'x' })).status).toBe(200);
    expect((await fetch(`${base}/access-request`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{not json' })).status).toBe(400);
    expect((await post(base, { ...VALID, hp_trap_7: 'x' })).status).toBe(200);
    expect((await post(base, VALID)).status).toBe(429);
  });
  it('[P63-3] the invite prefill has its own limit: it never spends the submit budget', async () => {
    const { base } = await start({ accessRequestLimiter: new FixedWindowRateLimiter(1, 60_000), accessRequestPrefillLimiter: new FixedWindowRateLimiter(2, 60_000) });
    const prefill = () => fetch(`${base}/access-request/invite`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: 'x' }) });
    expect((await prefill()).status).toBe(404);
    expect((await prefill()).status).toBe(404);
    expect((await prefill()).status).toBe(429); // its own cap
    expect((await post(base, VALID)).status).toBe(201); // the submit budget untouched
  });
});

// [P63-4 · owner] The form's messages are plain English, never a code name ("fullName is required.").
describe('[P63-4] plain-English messages', () => {
  it('each missing field says what to enter', async () => {
    const { base } = await start();
    const cases: Array<[string, string]> = [
      ['fullName', 'Please enter your full name.'],
      ['workEmail', 'Please enter your work email.'],
      ['phone', 'Please enter your phone number.'],
      ['companyName', 'Please enter your company name.'],
      ['roleTitle', 'Please enter your role or job title.'],
    ];
    for (const [field, message] of cases) {
      const res = await post(base, { ...VALID, [field]: '' });
      expect(res.status).toBe(400);
      expect(await res.json(), field).toEqual({ error: 'validation', field, message });
    }
  });
  it('too long says so in plain words', async () => {
    const { base } = await start();
    expect(await (await post(base, { ...VALID, fullName: 'x'.repeat(500) })).json()).toMatchObject({ message: 'Your full name is too long.' });
  });
  it('NEGATIVE: no message ever names a field by its code', async () => {
    const { base } = await start();
    for (const field of ['fullName', 'workEmail', 'phone', 'companyName', 'roleTitle']) {
      const { message } = (await (await post(base, { ...VALID, [field]: '' })).json()) as { message: string };
      expect(message).not.toMatch(/[a-z][A-Z]/); // camelCase
    }
  });
});
