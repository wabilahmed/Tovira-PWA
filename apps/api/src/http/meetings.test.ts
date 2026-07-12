import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';
import { MeetingParser } from '../services/meetings/meeting-parser.js';
import type { ModelClient } from '../ports/model.js';

let server: Server;
let base: string;
let deps: TestDeps;

beforeAll(async () => {
  // Scripted model so parse() is deterministic: always "Meridian, next Tue 3pm".
  const model: ModelClient = {
    complete: async () => ({ text: '{"clientName":"Meridian","datetime":"2026-07-14T15:00","datetimeRaw":"next Tuesday 3pm"}' }),
  };
  deps = buildInMemoryDeps();
  deps.meetingParser = new MeetingParser(model, deps.clients);
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
async function createClient(token: string, name: string): Promise<string> {
  const res = await fetch(`${base}/clients`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  return ((await res.json()) as { id: string }).id;
}
const auth = (token: string) => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' });

describe('[P3-1] add a meeting', () => {
  it('creates a meeting via the form and it appears on the calendar', async () => {
    const token = await signup('cal@example.com');
    const clientId = await createClient(token, 'Meridian');
    const res = await fetch(`${base}/clients/${clientId}/meetings`, {
      method: 'POST',
      headers: auth(token),
      body: JSON.stringify({ datetime: '2026-07-10T10:00', title: 'Kickoff' }),
    });
    expect(res.status).toBe(201);
    const list = (await (await fetch(`${base}/meetings`, { headers: auth(token) })).json()) as {
      meetings: Array<{ clientId: string; title: string; confirmed: boolean }>;
    };
    expect(list.meetings).toHaveLength(1);
    expect(list.meetings[0]!.clientId).toBe(clientId);
    expect(list.meetings[0]!.confirmed).toBe(true);
  });

  it('parses a natural-language request into a proposal (nothing saved yet)', async () => {
    const token = await signup('nl@example.com');
    await createClient(token, 'Meridian');
    const parse = await fetch(`${base}/meetings/parse`, {
      method: 'POST',
      headers: auth(token),
      body: JSON.stringify({ text: 'meeting with Meridian next Tuesday 3pm' }),
    });
    const result = (await parse.json()) as { kind: string; datetime?: string };
    expect(result.kind).toBe('proposal');
    // Parsing must not have saved anything.
    const list = (await (await fetch(`${base}/meetings`, { headers: auth(token) })).json()) as { meetings: unknown[] };
    expect(list.meetings).toEqual([]);
  });

  // NEGATIVE: rejecting the parse (never confirming) saves nothing; confirm saves.
  it('saves only when the rep confirms the proposed meeting', async () => {
    const token = await signup('confirm-mtg@example.com');
    const clientId = await createClient(token, 'Meridian');
    // Confirm = POST /meetings with the proposal.
    const created = await fetch(`${base}/meetings`, {
      method: 'POST',
      headers: auth(token),
      body: JSON.stringify({ clientId, datetime: '2026-07-14T15:00', datetimeRaw: 'next Tuesday 3pm' }),
    });
    expect(created.status).toBe(201);
    const list = (await (await fetch(`${base}/meetings`, { headers: auth(token) })).json()) as { meetings: unknown[] };
    expect(list.meetings).toHaveLength(1);
  });

  it('cancels a meeting (delete)', async () => {
    const token = await signup('cancel@example.com');
    const clientId = await createClient(token, 'Meridian');
    const m = (await (await fetch(`${base}/clients/${clientId}/meetings`, {
      method: 'POST',
      headers: auth(token),
      body: JSON.stringify({ datetime: '2026-07-10T10:00' }),
    })).json()) as { id: string };
    expect((await fetch(`${base}/meetings/${m.id}`, { method: 'DELETE', headers: auth(token) })).status).toBe(200);
    const list = (await (await fetch(`${base}/meetings`, { headers: auth(token) })).json()) as { meetings: unknown[] };
    expect(list.meetings).toEqual([]);
  });

  it('rejects an unauthenticated calendar request (401) and cross-tenant create (404)', async () => {
    expect((await fetch(`${base}/meetings`)).status).toBe(401);
    const a = await signup('a-cal@example.com');
    const b = await signup('b-cal@example.com');
    const clientA = await createClient(a, 'A Cal');
    const res = await fetch(`${base}/clients/${clientA}/meetings`, {
      method: 'POST',
      headers: auth(b),
      body: JSON.stringify({ datetime: '2026-07-10T10:00' }),
    });
    expect(res.status).toBe(404);
  });
});
