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

describe('[MEETING-CREATE] rep-created meetings + reschedule on the rep\'s clock', () => {
  async function signupTz(email: string, timezone: string): Promise<string> {
    const res = await fetch(`${base}/auth/signup`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'password123', timezone }),
    });
    return ((await res.json()) as { token: string }).token;
  }
  async function meId(token: string): Promise<string> {
    return ((await (await fetch(`${base}/me`, { headers: auth(token) })).json()) as { user: { id: string } }).user.id;
  }

  it('a rep-created meeting is confirmed:true and immediately nudge-eligible (no confirm step)', async () => {
    const token = await signupTz('repmade@example.com', 'Asia/Dubai');
    const clientId = await createClient(token, 'Meridian');
    const res = await fetch(`${base}/clients/${clientId}/meetings`, {
      method: 'POST', headers: auth(token), body: JSON.stringify({ datetime: '2026-07-09T15:00', datetimeRaw: '3pm', title: 'Site visit' }),
    });
    expect(res.status).toBe(201);
    const created = (await res.json()) as { id: string; confirmed: boolean; datetime: string };
    expect(created.confirmed).toBe(true);
    const userId = await meId(token);
    expect(await deps.meetings.dueForNudge(userId, '2026-07-09T00:00:00.000Z', '2026-07-09T23:59:59.000Z')).toHaveLength(1);
  });

  it('a meeting with no client cannot be saved (404)', async () => {
    const token = await signupTz('noclient@example.com', 'Asia/Dubai');
    const res = await fetch(`${base}/meetings`, {
      method: 'POST', headers: auth(token), body: JSON.stringify({ clientId: '', datetime: '2026-07-09T15:00', datetimeRaw: '3pm' }),
    });
    expect(res.status).toBe(404);
  });

  it('rescheduling (PATCH) re-resolves the wall-clock on the rep\'s zone', async () => {
    const token = await signupTz('resched@example.com', 'Asia/Dubai');
    const clientId = await createClient(token, 'Meridian');
    const m = (await (await fetch(`${base}/clients/${clientId}/meetings`, {
      method: 'POST', headers: auth(token), body: JSON.stringify({ datetime: '2026-07-09T15:00', datetimeRaw: '3pm' }),
    })).json()) as { id: string };
    const patched = await fetch(`${base}/meetings/${m.id}`, {
      method: 'PATCH', headers: auth(token), body: JSON.stringify({ datetime: '2026-07-09T17:00', datetimeRaw: '5pm' }),
    });
    expect(patched.status).toBe(200);
    expect(((await patched.json()) as { datetime: string }).datetime).toBe('2026-07-09T13:00:00.000Z'); // 17:00 Dubai
  });

  it('rescheduling an unknown meeting is 404', async () => {
    const token = await signupTz('resched404@example.com', 'Asia/Dubai');
    expect((await fetch(`${base}/meetings/nope/`.replace(/\/$/, ''), { method: 'PATCH', headers: auth(token), body: JSON.stringify({ title: 'x' }) })).status).toBe(404);
  });
});

describe('[NUDGE-UNCONFIRMED] a proposed meeting is confirmable via the queue', () => {
  async function meId(token: string): Promise<string> {
    return ((await (await fetch(`${base}/me`, { headers: auth(token) })).json()) as { user: { id: string } }).user.id;
  }
  it('an unconfirmed meeting shows in /confirmations; confirming clears it (and never nudges until then)', async () => {
    const token = await signup('unconf@example.com');
    const clientId = await createClient(token, 'Meridian');
    const userId = await meId(token);
    const m = await deps.meetings.create(userId, {
      clientId, datetime: new Date('2026-07-14T11:00:00.000Z').toISOString(), datetimeRaw: 'next Tuesday 3pm', title: null, confirmed: false, noteId: null,
    });
    // unconfirmed → never nudge-eligible
    expect(await deps.meetings.dueForNudge(userId, '2026-07-14T00:00:00.000Z', '2026-07-14T23:59:59.000Z')).toHaveLength(0);
    // surfaced in the confirmation queue as a pending meeting
    let q = (await (await fetch(`${base}/confirmations`, { headers: auth(token) })).json()) as { meetings: { id: string }[] };
    expect(q.meetings.map((x) => x.id)).toContain(m.id);
    // one-tap confirm
    const c = await fetch(`${base}/meetings/${m.id}/confirm`, { method: 'POST', headers: auth(token) });
    expect(c.status).toBe(200);
    expect(((await c.json()) as { confirmed: boolean }).confirmed).toBe(true);
    // gone from the queue, and now nudge-eligible
    q = (await (await fetch(`${base}/confirmations`, { headers: auth(token) })).json()) as { meetings: { id: string }[] };
    expect(q.meetings.map((x) => x.id)).not.toContain(m.id);
    expect(await deps.meetings.dueForNudge(userId, '2026-07-14T00:00:00.000Z', '2026-07-14T23:59:59.000Z')).toHaveLength(1);
  });

  it('confirming an unknown meeting is 404, and confirm requires auth (401)', async () => {
    const token = await signup('unconf404@example.com');
    expect((await fetch(`${base}/meetings/does-not-exist/confirm`, { method: 'POST', headers: auth(token) })).status).toBe(404);
    expect((await fetch(`${base}/meetings/x/confirm`, { method: 'POST' })).status).toBe(401);
  });
});

describe('[NUDGE-TZ] a wall-clock meeting time is resolved in the rep\'s timezone', () => {
  async function signupTz(email: string, timezone: string): Promise<string> {
    const res = await fetch(`${base}/auth/signup`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'password123', timezone }),
    });
    return ((await res.json()) as { token: string }).token;
  }
  async function createMeeting(token: string, clientId: string, datetime: string): Promise<string> {
    const res = await fetch(`${base}/clients/${clientId}/meetings`, {
      method: 'POST', headers: auth(token), body: JSON.stringify({ datetime, datetimeRaw: '3pm' }),
    });
    return ((await res.json()) as { datetime: string }).datetime;
  }

  it('stores 15:00 for a Dubai rep as 11:00Z (regardless of the server clock)', async () => {
    const token = await signupTz('dubai@example.com', 'Asia/Dubai');
    const clientId = await createClient(token, 'Meridian');
    expect(await createMeeting(token, clientId, '2026-07-09T15:00')).toBe('2026-07-09T11:00:00.000Z');
    // and /me reports the stored IANA zone (not an offset)
    const me = (await (await fetch(`${base}/me`, { headers: auth(token) })).json()) as { user: { timezone: string } };
    expect(me.user.timezone).toBe('Asia/Dubai');
  });

  it('a rep in another timezone gets their own local resolution (15:00 New York = 19:00Z in July)', async () => {
    const token = await signupTz('ny@example.com', 'America/New_York');
    const clientId = await createClient(token, 'Meridian');
    expect(await createMeeting(token, clientId, '2026-07-09T15:00')).toBe('2026-07-09T19:00:00.000Z');
  });

  it('an invalid timezone at signup falls back to the default (Asia/Dubai), and Settings can change it', async () => {
    const token = await signupTz('bad-tz@example.com', '+04:00'); // an offset, not IANA → rejected
    let me = (await (await fetch(`${base}/me`, { headers: auth(token) })).json()) as { user: { timezone: string } };
    expect(me.user.timezone).toBe('Asia/Dubai');
    // edit it in Settings
    const put = await fetch(`${base}/me/timezone`, { method: 'PUT', headers: auth(token), body: JSON.stringify({ timezone: 'Europe/London' }) });
    expect(put.status).toBe(200);
    expect(((await put.json()) as { timezone: string }).timezone).toBe('Europe/London');
    me = (await (await fetch(`${base}/me`, { headers: auth(token) })).json()) as { user: { timezone: string } };
    expect(me.user.timezone).toBe('Europe/London');
  });
});
