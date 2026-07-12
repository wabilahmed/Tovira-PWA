import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { AuthService } from '../services/auth/auth-service.js';
import { ScryptHasher } from '../services/auth/password.js';
import { InMemoryUserRepository } from '../adapters/auth/in-memory-user-repository.js';
import { InMemorySessionRepository } from '../adapters/auth/in-memory-session-repository.js';
import { InMemoryClientRepository } from '../adapters/clients/in-memory-client-repository.js';
import { InMemoryNoteRepository } from '../adapters/notes/in-memory-note-repository.js';
import { InMemoryStorage } from '../adapters/storage/in-memory.js';

const stubPool = { query: async () => ({ rows: [] }) } as unknown as import('pg').Pool;

let server: Server;
let base: string;

beforeAll(async () => {
  const auth = new AuthService({
    users: new InMemoryUserRepository(),
    sessions: new InMemorySessionRepository(),
    hasher: new ScryptHasher(),
    sessionTtlMs: 60 * 60 * 1000,
  });
  server = createApiServer({
    pool: stubPool,
    auth,
    clients: new InMemoryClientRepository(),
    notes: new InMemoryNoteRepository(),
    storage: new InMemoryStorage(),
  });
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
