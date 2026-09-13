import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps } from './test-deps.js';

let server: Server;
let base: string;

beforeAll(async () => {
  server = createApiServer(buildInMemoryDeps());
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

async function signup(email: string): Promise<string> {
  const res = await fetch(`${base}/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'password123' }),
  });
  return ((await res.json()) as { token: string }).token;
}

function authed(token: string, extra: RequestInit = {}): RequestInit {
  return { ...extra, headers: { authorization: `Bearer ${token}`, ...(extra.headers ?? {}) } };
}

describe('clients HTTP endpoints (tenant-scoped)', () => {
  it('creates a client for the authed rep and lists it back', async () => {
    const token = await signup('a@example.com');
    const create = await fetch(`${base}/clients`, authed(token, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Meridian Corp' }),
    }));
    expect(create.status).toBe(201);
    const client = (await create.json()) as { id: string; name: string };
    expect(client.name).toBe('Meridian Corp');

    const list = await fetch(`${base}/clients`, authed(token));
    expect(list.status).toBe(200);
    const clients = (await list.json()) as { clients: Array<{ id: string }> };
    expect(clients.clients.map((c) => c.id)).toContain(client.id);
  });

  // [P4-7] optional phone: set at create, editable via PATCH, tenant-scoped.
  it('creates a client with an optional phone and returns it', async () => {
    const token = await signup('phone-create@example.com');
    const create = await fetch(`${base}/clients`, authed(token, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Acme', phone: '+971 50 123 4567' }),
    }));
    expect(create.status).toBe(201);
    expect(((await create.json()) as { phone: string }).phone).toBe('+971 50 123 4567');
  });

  it('sets a client phone via PATCH and reads it back', async () => {
    const token = await signup('phone-patch@example.com');
    const id = ((await (await fetch(`${base}/clients`, authed(token, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Acme' }),
    }))).json()) as { id: string }).id;

    const patch = await fetch(`${base}/clients/${id}`, authed(token, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone: '+971501234567' }),
    }));
    expect(patch.status).toBe(200);
    const got = (await (await fetch(`${base}/clients/${id}`, authed(token))).json()) as { phone: string };
    expect(got.phone).toBe('+971501234567');
  });

  it('never lets a rep set the phone on another rep\'s client (404)', async () => {
    const owner = await signup('phone-owner@example.com');
    const other = await signup('phone-other@example.com');
    const id = ((await (await fetch(`${base}/clients`, authed(owner, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Acme' }),
    }))).json()) as { id: string }).id;

    const patch = await fetch(`${base}/clients/${id}`, authed(other, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone: '+10000000000' }),
    }));
    expect(patch.status).toBe(404);
    // The owner's client is untouched.
    const got = (await (await fetch(`${base}/clients/${id}`, authed(owner))).json()) as { phone: string | null };
    expect(got.phone).toBeNull();
  });

  // [P1-2] search + recents-first ordering.
  it('filters clients by a partial name query', async () => {
    const token = await signup('search@example.com');
    const create = async (name: string) =>
      fetch(`${base}/clients`, authed(token, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      }));
    await create('Meridian Corp');
    await create('Northwind Trading');
    const res = await fetch(`${base}/clients?q=north`, authed(token));
    const body = (await res.json()) as { clients: Array<{ name: string }> };
    expect(body.clients.map((c) => c.name)).toEqual(['Northwind Trading']);
  });

  it('returns an empty list (clear no-results) when the query matches nothing', async () => {
    const token = await signup('noresults@example.com');
    await fetch(`${base}/clients`, authed(token, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Meridian Corp' }),
    }));
    const res = await fetch(`${base}/clients?q=zzzz`, authed(token));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { clients: unknown[] };
    expect(body.clients).toEqual([]);
  });

  it('lists the most recently created client first (recents default)', async () => {
    const token = await signup('recents@example.com');
    const create = async (name: string) =>
      (await (await fetch(`${base}/clients`, authed(token, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      }))).json()) as { id: string };
    await create('Older');
    const newer = await create('Newer');
    const list = (await (await fetch(`${base}/clients`, authed(token))).json()) as {
      clients: Array<{ id: string }>;
    };
    expect(list.clients[0]!.id).toBe(newer.id);
  });

  it('lets the owner fetch their client by id', async () => {
    const token = await signup('owner@example.com');
    const created = (await (await fetch(`${base}/clients`, authed(token, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Acme' }),
    }))).json()) as { id: string };
    const got = await fetch(`${base}/clients/${created.id}`, authed(token));
    expect(got.status).toBe(200);
  });

  // [P1-1] two clients with the same name are both allowed and distinguishable.
  it('allows two clients with the same name (distinct ids)', async () => {
    const token = await signup('same@example.com');
    const mk = async () =>
      (await (await fetch(`${base}/clients`, authed(token, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Meridian Corp' }),
      }))).json()) as { id: string; name: string };
    const a = await mk();
    const b = await mk();
    expect(a.name).toBe('Meridian Corp');
    expect(b.name).toBe('Meridian Corp');
    expect(a.id).not.toBe(b.id);
  });

  // [P1-1] NEGATIVE: empty / whitespace name is rejected with a validation message.
  it('rejects an empty or whitespace-only client name with 400', async () => {
    const token = await signup('empty@example.com');
    for (const name of ['', '   ']) {
      const res = await fetch(`${base}/clients`, authed(token, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      }));
      expect(res.status).toBe(400);
      const body = (await res.json()) as { message?: string };
      expect(body.message).toBeTruthy();
    }
  });

  // NEGATIVE — the isolation trust rules
  it('rejects unauthenticated create and list with 401', async () => {
    const create = await fetch(`${base}/clients`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'X' }),
    });
    expect(create.status).toBe(401);
    expect((await fetch(`${base}/clients`)).status).toBe(401);
  });

  it('does not leak another rep\'s client by id (IDOR → 404)', async () => {
    const tokenA = await signup('repA@example.com');
    const tokenB = await signup('repB@example.com');
    const aClient = (await (await fetch(`${base}/clients`, authed(tokenA, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'A Secret Corp' }),
    }))).json()) as { id: string };

    // B knows the exact id but must never see it.
    const asB = await fetch(`${base}/clients/${aClient.id}`, authed(tokenB));
    expect(asB.status).toBe(404);
    // And it never appears in B's list.
    const bList = (await (await fetch(`${base}/clients`, authed(tokenB))).json()) as {
      clients: Array<{ id: string }>;
    };
    expect(bList.clients.map((c) => c.id)).not.toContain(aClient.id);
  });
});

// [OUTCOME-3] The rep confirm control writes over HTTP: won / lost / still open. Setting any of them
// records outcome_source='rep'. "Still open" is not a no-op — it resets the going-quiet clock.
describe('[OUTCOME-3] client outcome endpoint (rep-set, tenant-scoped)', () => {
  async function makeClient(token: string, name: string): Promise<{ id: string; lastTouchedAt: number }> {
    return (await (await fetch(`${base}/clients`, authed(token, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }),
    }))).json()) as { id: string; lastTouchedAt: number };
  }
  function setOutcome(token: string, id: string, outcome: string): Promise<Response> {
    return fetch(`${base}/clients/${id}/outcome`, authed(token, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ outcome }),
    }));
  }

  it('marks a client won, recording the rep as the source', async () => {
    const token = await signup('outcome-won@example.com');
    const c = await makeClient(token, 'Won Corp');
    const res = await setOutcome(token, c.id, 'won');
    expect(res.status).toBe(200);
    const after = (await res.json()) as { outcome: string; outcomeSource: string };
    expect(after.outcome).toBe('won');
    expect(after.outcomeSource).toBe('rep');
  });

  it('maps "lost" to lost_confirmed (a rep-confirmed loss, distinct from inferred)', async () => {
    const token = await signup('outcome-lost@example.com');
    const c = await makeClient(token, 'Lost Corp');
    const after = (await (await setOutcome(token, c.id, 'lost')).json()) as { outcome: string; outcomeSource: string };
    expect(after.outcome).toBe('lost_confirmed');
    expect(after.outcomeSource).toBe('rep');
  });

  it('is reversible: a rep can move an outcome back to open later', async () => {
    const token = await signup('outcome-reverse@example.com');
    const c = await makeClient(token, 'Reversible Corp');
    await setOutcome(token, c.id, 'lost');
    const after = (await (await setOutcome(token, c.id, 'open')).json()) as { outcome: string; outcomeSource: string };
    expect(after.outcome).toBe('open');
    expect(after.outcomeSource).toBe('rep'); // a rep-set open still wins over inference
  });

  it('"still open" resets the going-quiet clock (bumps last_touched_at)', async () => {
    const token = await signup('outcome-clock@example.com');
    const c = await makeClient(token, 'Clock Corp');
    const after = (await (await setOutcome(token, c.id, 'open')).json()) as { lastTouchedAt: number };
    expect(after.lastTouchedAt).toBeGreaterThan(c.lastTouchedAt);
  });

  it('rejects an unknown outcome value (400)', async () => {
    const token = await signup('outcome-bad@example.com');
    const c = await makeClient(token, 'Bad Corp');
    expect((await setOutcome(token, c.id, 'maybe')).status).toBe(400);
  });

  it('requires auth', async () => {
    const token = await signup('outcome-auth@example.com');
    const c = await makeClient(token, 'Auth Corp');
    expect((await fetch(`${base}/clients/${c.id}/outcome`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ outcome: 'won' }),
    })).status).toBe(401);
  });

  // ISOLATION: another rep cannot set (or even address) your client's outcome.
  it('never lets another rep set a client outcome (IDOR → 404)', async () => {
    const tokenA = await signup('outcome-idorA@example.com');
    const tokenB = await signup('outcome-idorB@example.com');
    const a = await makeClient(tokenA, 'A Corp');
    expect((await setOutcome(tokenB, a.id, 'won')).status).toBe(404);
    // A's client is untouched.
    const stillOpen = (await (await fetch(`${base}/clients/${a.id}`, authed(tokenA))).json()) as { outcome: string };
    expect(stillOpen.outcome).toBe('open');
  });
});
