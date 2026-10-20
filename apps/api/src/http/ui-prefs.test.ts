import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps } from './test-deps.js';

/**
 * [P36-5] Which client-page sections a rep keeps open is remembered PER REP, ACROSS DEVICES — stored with the
 * account, not the browser. Only the known sections and booleans are kept; anything else is ignored.
 */
let server: Server;
let base: string;
beforeAll(async () => {
  server = createApiServer(buildInMemoryDeps());
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

const json = { 'content-type': 'application/json' };
async function login(email: string, signup = false): Promise<string> {
  const res = await fetch(`${base}/auth/${signup ? 'signup' : 'login'}`, { method: 'POST', headers: json, body: JSON.stringify({ email, password: 'password123' }) });
  return ((await res.json()) as { token: string }).token;
}

describe('[P36-5] client-page section state is saved with the rep\'s account', () => {
  it('needs a session', async () => {
    expect((await fetch(`${base}/me/ui-prefs`)).status).toBe(401);
  });

  it('a new rep starts with nothing saved (the page uses its defaults)', async () => {
    const token = await login('prefs-new@example.com', true);
    const out = (await (await fetch(`${base}/me/ui-prefs`, { headers: { authorization: `Bearer ${token}` } })).json()) as { clientSections: Record<string, boolean> };
    expect(out.clientSections).toEqual({});
  });

  it('saved on one device, restored in another session', async () => {
    const phone = await login('prefs@example.com', true);
    const put = await fetch(`${base}/me/ui-prefs`, { method: 'PUT', headers: { ...json, authorization: `Bearer ${phone}` }, body: JSON.stringify({ clientSections: { promises: false, conversations: true } }) });
    expect(put.status).toBe(200);
    const laptop = await login('prefs@example.com');
    expect(laptop).not.toBe(phone);
    const out = (await (await fetch(`${base}/me/ui-prefs`, { headers: { authorization: `Bearer ${laptop}` } })).json()) as { clientSections: Record<string, boolean> };
    expect(out.clientSections).toEqual({ promises: false, conversations: true });
  });

  it('merges per section, and ignores unknown sections and non-boolean values', async () => {
    const token = await login('prefs-merge@example.com', true);
    const put = (body: unknown) => fetch(`${base}/me/ui-prefs`, { method: 'PUT', headers: { ...json, authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    await put({ clientSections: { people: true } });
    await put({ clientSections: { wants: false, nonsense: true, meetings: 'yes' }, other: { x: 1 } });
    const out = (await (await fetch(`${base}/me/ui-prefs`, { headers: { authorization: `Bearer ${token}` } })).json()) as Record<string, unknown>;
    expect(out).toEqual({ clientSections: { people: true, wants: false } });
  });
});
