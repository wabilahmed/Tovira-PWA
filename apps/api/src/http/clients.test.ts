import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';

let server: Server;
let base: string;
let deps: TestDeps;

beforeAll(async () => {
  deps = buildInMemoryDeps();
  server = createApiServer(deps);
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

  // [P12] The legacy GET /clients?q= name-search was removed (a client name must never ride in a URL).
  // Search is now done client-side in the PWA; see apps/web/src/clients/searchClients.test.ts.
  it('ignores any ?q= and always returns the full list (no name-in-URL search endpoint)', async () => {
    const token = await signup('noqsearch@example.com');
    const create = async (name: string) =>
      fetch(`${base}/clients`, authed(token, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }),
      }));
    await create('Meridian Corp');
    await create('Northwind Trading');
    // A stray ?q= must NOT filter server-side — the endpoint returns everything, as if the query weren't there.
    const res = await fetch(`${base}/clients?q=north`, authed(token));
    const body = (await res.json()) as { clients: Array<{ name: string }> };
    expect(body.clients.map((c) => c.name).sort()).toEqual(['Meridian Corp', 'Northwind Trading']);
  });

  // [P12 · pagination guard] The PWA searches CLIENT-SIDE, so the list endpoint must return EVERY
  // client (with phone + email) — if it ever paged/capped, client-side search would silently miss
  // clients. Prove it with 600: all come back, and the 600th (uniquely named, with phone + email) is
  // present in the payload so the browser can find it.
  it('returns the FULL list (no cap) with phone + email — 600 clients, incl. the 600th', async () => {
    const su = (await (await fetch(`${base}/auth/signup`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'bulk600@example.com', password: 'password123' }),
    })).json()) as { token: string; user: { id: string } };
    // Seed directly through the in-memory repo (600 HTTP round-trips would just slow the suite; the
    // endpoint path is exercised by the GET below). The 600th is uniquely named with a phone + email.
    for (let i = 1; i <= 599; i++) await deps.clients.create(su.user.id, `Client ${i}`);
    await deps.clients.create(su.user.id, 'Zephyr Logistics 600', '+971 50 999 6000', null, 'ops@zephyr600.ae');
    const body = (await (await fetch(`${base}/clients`, authed(su.token))).json()) as {
      clients: Array<{ name: string; phone: string | null; email: string | null }>;
    };
    expect(body.clients).toHaveLength(600);
    const last = body.clients.find((c) => c.name === 'Zephyr Logistics 600');
    expect(last).toBeTruthy();
    // The fields the client-side search matches on are all present in the list payload.
    expect(last!.phone).toBe('+971 50 999 6000');
    expect(last!.email).toBe('ops@zephyr600.ae');
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

  it('is reversible, and "still open" is a snooze not a pin: it leaves outcome_source unset', async () => {
    const token = await signup('outcome-reverse@example.com');
    const c = await makeClient(token, 'Reversible Corp');
    await setOutcome(token, c.id, 'lost');
    const after = (await (await setOutcome(token, c.id, 'open')).json()) as { outcome: string; outcomeSource: string | null };
    expect(after.outcome).toBe('open');
    // [FOLLOWUP-1] "still open" states the present, not the outcome — it does NOT pin the client
    // against inference. outcome_source is left unset, so a later silence run can still infer a loss.
    expect(after.outcomeSource).toBeNull();
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

// [LEAD-STATUS] The rep's MANUAL pipeline label over HTTP: warm / cold / done, or null = Unsorted.
// Distinct from outcome (how a deal ended) — this is the rep's own pipeline sorting, never set by any
// automatic process. A rep may move a client to any status, any time, including back to Unsorted.
describe('[LEAD-STATUS] client lead-status endpoint (rep-set only, tenant-scoped)', () => {
  async function makeClient(token: string, name: string): Promise<{ id: string; leadStatus: string | null; leadStatusChangedAt: number | null }> {
    return (await (await fetch(`${base}/clients`, authed(token, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }),
    }))).json()) as { id: string; leadStatus: string | null; leadStatusChangedAt: number | null };
  }
  function setStatus(token: string, id: string, body: unknown): Promise<Response> {
    return fetch(`${base}/clients/${id}/lead-status`, authed(token, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }));
  }

  it('defaults a new client to Unsorted (leadStatus null)', async () => {
    const token = await signup('lead-default@example.com');
    const c = await makeClient(token, 'Fresh Corp');
    expect(c.leadStatus).toBeNull();
    expect(c.leadStatusChangedAt).toBeNull();
  });

  it('lets the rep move a client through every status and back to Unsorted', async () => {
    const token = await signup('lead-transitions@example.com');
    const c = await makeClient(token, 'Pipeline Corp');
    for (const status of ['warm', 'cold', 'done'] as const) {
      const res = await setStatus(token, c.id, { status });
      expect(res.status).toBe(200);
      const after = (await res.json()) as { leadStatus: string; leadStatusChangedAt: number };
      expect(after.leadStatus).toBe(status);
      expect(after.leadStatusChangedAt).toBeGreaterThan(0);
    }
    // Back to Unsorted (explicit null) — an accepted action, not a missing value.
    const cleared = (await (await setStatus(token, c.id, { status: null })).json()) as { leadStatus: string | null };
    expect(cleared.leadStatus).toBeNull();
  });

  it('rejects any value that is not warm / cold / done / null (400)', async () => {
    const token = await signup('lead-bad@example.com');
    const c = await makeClient(token, 'Bad Corp');
    for (const body of [{ status: 'unsorted' }, { status: 'maybe' }, { status: 1 }, {} /* missing key */]) {
      expect((await setStatus(token, c.id, body)).status).toBe(400);
    }
    // None of the rejected calls changed the stored value.
    const got = (await (await fetch(`${base}/clients/${c.id}`, authed(token))).json()) as { leadStatus: string | null };
    expect(got.leadStatus).toBeNull();
  });

  it('requires auth', async () => {
    const token = await signup('lead-auth@example.com');
    const c = await makeClient(token, 'Auth Corp');
    expect((await fetch(`${base}/clients/${c.id}/lead-status`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'warm' }),
    })).status).toBe(401);
  });

  // ISOLATION: another rep cannot set (or even address) your client's lead_status.
  it('never lets another rep set a client lead_status (IDOR → 404)', async () => {
    const tokenA = await signup('lead-idorA@example.com');
    const tokenB = await signup('lead-idorB@example.com');
    const a = await makeClient(tokenA, 'A Corp');
    expect((await setStatus(tokenB, a.id, { status: 'warm' })).status).toBe(404);
    // A's client is untouched (still Unsorted).
    const still = (await (await fetch(`${base}/clients/${a.id}`, authed(tokenA))).json()) as { leadStatus: string | null };
    expect(still.leadStatus).toBeNull();
  });
});
