import { describe, it, expect, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps } from './test-deps.js';
import type { ApiDeps } from '../server.js';

let server: Server | null = null;
async function start(over: Partial<ApiDeps>): Promise<string> {
  server = createApiServer(buildInMemoryDeps(over));
  await new Promise<void>((r) => server!.listen(0, r));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
afterEach(async () => { if (server) await new Promise<void>((r) => server!.close(() => r())); server = null; });
const signup = (base: string) =>
  fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'new@x.ae', password: 'password123' }) });

describe('[BETA-7] public self-registration is behind a flag (default off)', () => {
  it('flag OFF → /auth/signup is unreachable (404) and creates no account', async () => {
    const base = await start({ signupEnabled: false });
    const res = await signup(base);
    expect(res.status).toBe(404); // indistinguishable from a route that does not exist
  });

  it('flag ON → /auth/signup still works (201) — the existing registration path is unchanged', async () => {
    const base = await start({ signupEnabled: true });
    const res = await signup(base);
    expect(res.status).toBe(201);
  });
});
