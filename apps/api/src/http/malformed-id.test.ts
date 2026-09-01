import { describe, it, expect } from 'vitest';
import type { AddressInfo } from 'node:net';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps } from './test-deps.js';

/**
 * [MALFORMED-ID] A malformed path id reaches Postgres as an invalid uuid (SQLSTATE
 * 22P02) and used to surface as a 500. The server maps 22P02 to a generic 400 for
 * EVERY id-taking route at once, and never leaks the underlying message/stack.
 * (In-memory repos don't validate uuid shape, so we simulate the DB error.)
 */
describe('[MALFORMED-ID] a malformed path id → 400, not 500', () => {
  it('maps a Postgres invalid-uuid error (22P02) to a generic 400 with no internal detail', async () => {
    const deps = buildInMemoryDeps();
    const srv = createApiServer(deps);
    await new Promise<void>((r) => srv.listen(0, r));
    const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    try {
      const { token } = (await (await fetch(`${base}/auth/signup`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'malformed@example.com', password: 'password123' }),
      })).json()) as { token: string };

      // Real Postgres throws code '22P02' for a non-uuid id; simulate it on the lookup.
      const pgErr = Object.assign(new Error('invalid input syntax for type uuid: "not-a-uuid"'), { code: '22P02' });
      deps.clients.findByIdForUser = async () => { throw pgErr; };

      const res = await fetch(`${base}/clients/not-a-uuid`, { headers: { authorization: `Bearer ${token}` } });
      expect(res.status).toBe(400); // not 500
      const raw = await res.text();
      const body = JSON.parse(raw) as { error: string; message?: string };
      expect(body.error).toBe('bad_request');
      // No stack trace, no raw value, no PG detail reaches the client.
      expect(raw).not.toMatch(/uuid|syntax|invalid input|\bat \b|stack/i);
    } finally {
      await new Promise<void>((r) => srv.close(() => r()));
    }
  });
});
