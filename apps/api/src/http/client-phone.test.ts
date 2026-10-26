import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps } from './test-deps.js';
import { canonicalPhone } from '../services/clients/phone.js';

// [P46-4] Owner: a client phone is validated on save and stored in its canonical international form (+971503863103);
// the app shows it as "+971 50 386 3103". A number without a country code is refused with a clear fix: Tovira never
// guesses the country (a wrong number is worse than a missing one).
let server: Server;
let base: string;
beforeAll(async () => {
  server = createApiServer(buildInMemoryDeps());
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

async function rep(email: string): Promise<{ token: string; id: string }> {
  const token = ((await (await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'password123' }) })).json()) as { token: string }).token;
  const c = (await (await fetch(`${base}/clients`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Sara' }) })).json()) as { id: string };
  return { token, id: c.id };
}
const patch = (r: { token: string; id: string }, phone: string) =>
  fetch(`${base}/clients/${r.id}`, { method: 'PATCH', headers: { authorization: `Bearer ${r.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ phone }) });

describe('[P46-4] canonicalPhone', () => {
  it('reads +, 00 and spaced forms into one canonical number', () => {
    for (const raw of ['+971 50 386 3103', '+971503863103', '00971 50 386 3103', '+971-50-386-3103', '(+971) 50 386 3103']) {
      expect(canonicalPhone(raw)).toEqual({ ok: true, phone: '+971503863103' });
    }
    expect(canonicalPhone('+44 7911 123456')).toEqual({ ok: true, phone: '+447911123456' });
  });
  it('NEGATIVE: no country code → refused with the fix; never guessed', () => {
    expect(canonicalPhone('050 386 3103')).toEqual({ ok: false, message: 'Add the country code, for example +971 50 123 4567.' });
  });
  it('NEGATIVE: not a real number → refused', () => {
    expect(canonicalPhone('+971 12')).toEqual({ ok: false, message: 'That doesn’t look like a phone number. Check it and try again.' });
    expect(canonicalPhone('call me')).toMatchObject({ ok: false });
  });
});

describe('[P46-4] saving a client phone', () => {
  it('PATCH stores the canonical form', async () => {
    const r = await rep('p1@example.com');
    const res = await patch(r, '+971 50 386 3103');
    expect(res.status).toBe(200);
    expect(((await res.json()) as { phone: string }).phone).toBe('+971503863103');
  });
  it('NEGATIVE: PATCH without a country code → 400 with the fix, and nothing changes', async () => {
    const r = await rep('p2@example.com');
    await patch(r, '+971 50 386 3103');
    const res = await patch(r, '0503863103');
    expect(res.status).toBe(400);
    expect(((await res.json()) as { message: string }).message).toBe('Add the country code, for example +971 50 123 4567.');
    const got = (await (await fetch(`${base}/clients/${r.id}`, { headers: { authorization: `Bearer ${r.token}` } })).json()) as { phone: string };
    expect(got.phone).toBe('+971503863103');
  });
  it('clearing the phone still works', async () => {
    const r = await rep('p3@example.com');
    await patch(r, '+971 50 386 3103');
    const res = await patch(r, '');
    expect(((await res.json()) as { phone: string | null }).phone).toBeNull();
  });
  it('NEGATIVE: create with a number without a country code → 400', async () => {
    const token = ((await (await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'p4@example.com', password: 'password123' }) })).json()) as { token: string }).token;
    const res = await fetch(`${base}/clients`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Omar', phone: '0501234567' }) });
    expect(res.status).toBe(400);
  });
});
