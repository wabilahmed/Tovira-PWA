import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';
import { listenForTest } from '../test-support/listen.js';
import { DailyDigestService } from '../services/digest/daily-digest-service.js';
import { InMemoryPrioritiesRepository } from '../adapters/priorities/in-memory-priorities-repository.js';
import { RestrictionService } from '../services/erasure/restriction.js';
import { restrictedTodayView } from '../services/hero/today-restriction.js';
import type { TodayAction } from '../services/hero/hero-service.js';
import type { PushableAlert } from '../services/push/push-dispatch-service.js';
import type { StubPushSender } from '../adapters/push/stub-sender.js';

/**
 * [P87-3 · owner, 25 Nov] P86 found a pre-window alert built from a restricted person's fact that did not NAME them
 * ("<their words> lease ends") still showing in notifications. The owner asked: does the same gap exist in the daily
 * digest, push notifications, the Monday Statement or the pre-meeting brief? One test per surface, each with a control
 * rep (no restriction) who sees the same fixture, so a pass proves the fixture really reaches the surface.
 *
 * The fixture never names him in anything derived: Khalid's messages carry the marker, and so do the promise, the
 * meeting, the key date and the pointer read from them, but none of those says "Khalid". Every date is relative to now,
 * so the fixture stays inside the windows (nudge lead, reminder window, this week) whenever the test runs.
 * Found: the brief's pointers (withheld only when their text named him; the client's pointer card and the data export
 * had the same rule) and the daily digest's count (it counted a cached Today item the restriction withholds). All now
 * use the same rule as Today and notifications. Push and the Monday Statement already held (they read the restricted
 * views when they are built); their tests pin it.
 */
const MARK = 'LANTERNFJORD';
const DAY = 86_400_000;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

let server: Server; let base: string; let deps: TestDeps;
type Rep = { u: string; H: Record<string, string>; clientId: string };
let control: Rep; let restricted: Rep;

async function rep(email: string): Promise<Rep> {
  const s = (await (await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'password123' }) })).json()) as { token: string; user: { id: string } };
  const u = s.user.id;
  const now = Date.now();
  const c = await deps.clients.create(u, 'Marina Estates');
  const said = isoDay(now - 2 * DAY);
  const K1 = `${MARK} the viewing tomorrow works for me`;
  const K2 = `${MARK} I will send the passport copy, my lease ends soon`;
  const K3 = `${MARK} price is too high, I need a better number`;
  const note = await deps.notes.create(u, {
    clientId: c.id, source: 'whatsapp_export', audioKey: null, status: 'extracted', rawText: 'chat',
    messages: [
      { sentAt: `${said}T10:00`, sender: 'Khalid', body: K1, media: false, role: 'client' },
      { sentAt: `${said}T10:01`, sender: 'Khalid', body: K2, media: false, role: 'client' },
      { sentAt: `${said}T10:02`, sender: 'Khalid', body: K3, media: false, role: 'client' },
      { sentAt: `${said}T10:05`, sender: 'Rep', body: 'noted', media: false, role: 'rep' },
    ],
  } as never);
  await deps.facts.saveExtraction(u, {
    noteId: note.id, clientId: c.id,
    promises: [{ text: `Send the ${MARK} passport copy`, owner: 'client', due_date: isoDay(now + 2 * DAY), due_raw: 'soon', confidence: 'high', source_span: K2, source_message_at: `${said}T10:01` }],
    keyDates: [{ description: `${MARK} lease ends`, date: isoDay(now + 3 * DAY), date_raw: 'soon', type: 'deadline', source_span: K2, source_message_at: `${said}T10:01` }],
  });
  await deps.meetings.create(u, { clientId: c.id, datetime: new Date(now + 3 * 3_600_000).toISOString(), datetimeRaw: `${MARK} viewing tomorrow`, title: `${MARK} viewing`, confirmed: true, noteId: note.id, sourceSpan: K1, sourceMessageAt: `${said}T10:00`, captureAt: said });
  await deps.clientPointers!.save(u, c.id, { pointers: [{ section: 'relationship', text: `Pushes hard on price (${MARK})`, receipts: [{ source_span: K3, source_message_at: `${said}T10:02` }] }], retrospectiveDisclosure: null }, now);
  await deps.pushSubscriptions.save(u, { endpoint: `https://push.example/${u}`, keys: { p256dh: 'k', auth: 'a' } });
  return { u, H: { authorization: `Bearer ${s.token}` }, clientId: c.id };
}

const restrict = (u: string) => deps.erasureRequests.create(u, { requesterNames: ['Khalid'], requestedAt: Date.now(), windowEndsAt: Date.now() + 10 * DAY });
const pushedTo = (u: string) => JSON.stringify((deps.pushSender as StubPushSender).sent.filter((s) => s.subscription.endpoint.endsWith(u)).map((s) => s.payload));
const get = async (r: Rep, path: string) => (await fetch(`${base}${path}`, { headers: r.H })).text();

beforeAll(async () => {
  deps = buildInMemoryDeps();
  server = createApiServer(deps);
  await listenForTest(server);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  control = await rep('unnamed-control@example.com');
  restricted = await rep('unnamed-restricted@example.com');
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

describe('[P87-3] nothing built from a restricted person\'s words shows, even when it does not name them', () => {
  it('the pre-meeting brief: no pointer, promise, date or meeting read from them', async () => {
    expect(await get(control, `/clients/${control.clientId}/brief`)).toContain(MARK); // the fixture reaches the brief
    await restrict(restricted.u);
    expect(await get(restricted, `/clients/${restricted.clientId}/brief`)).not.toContain(MARK);
  });

  it('the same pointer is withheld from the client\'s pointer card and from the data export (same rule as the brief)', async () => {
    await restrict(restricted.u);
    expect(await get(control, `/clients/${control.clientId}/pointers`)).toContain(MARK);
    expect(await get(restricted, `/clients/${restricted.clientId}/pointers`)).not.toContain(MARK);
    const pointersOf = async (r: Rep) => JSON.stringify((JSON.parse(await get(r, '/account/export')) as { clientPointers: unknown }).clientPointers);
    expect(await pointersOf(control)).toContain(MARK);
    expect(await pointersOf(restricted)).not.toContain(MARK);
  });

  it('push notifications: the scan pushes nothing built from them (the meeting nudge is time-critical)', async () => {
    await fetch(`${base}/scan`, { method: 'POST', headers: control.H });
    expect(pushedTo(control.u)).toContain(MARK); // the nudge for the meeting he set pushes for the control rep
    await restrict(restricted.u);
    await fetch(`${base}/scan`, { method: 'POST', headers: restricted.H });
    expect(pushedTo(restricted.u)).not.toContain(MARK);
  });

  it('the Monday Statement: neither the statement nor its alert carries them', async () => {
    expect(await get(control, '/monday-digest')).toContain(MARK);
    await restrict(restricted.u);
    expect(await get(restricted, '/monday-digest')).not.toContain(MARK);
    await deps.monday.notifyMonday(restricted.u, Date.now());
    expect(JSON.stringify(await deps.notifications.listByUser(restricted.u))).not.toContain(MARK);
    expect(pushedTo(restricted.u)).not.toContain(MARK);
  });

  it('the daily digest: a Today list cached before the window does not count their item', async () => {
    // Today's list for both reps, cached BEFORE any restriction (the nightly precompute), holding his promise
    const fresh = async (email: string) => {
      const r = await rep(email);
      const actions = (JSON.parse(await get(r, '/today')) as { actions: TodayAction[] }).actions;
      expect(JSON.stringify(actions)).toContain(MARK);
      return { r, actions };
    };
    const a = await fresh('digest-control@example.com');
    const b = await fresh('digest-restricted@example.com');
    await restrict(b.r.u);
    const restriction = new RestrictionService({ requests: deps.erasureRequests });
    const priorities = new InMemoryPrioritiesRepository();
    const now = Date.now();
    for (const x of [a, b]) await priorities.save(x.r.u, isoDay(now), x.actions, 0);
    const sent: Array<{ userId: string; alerts: PushableAlert[] }> = [];
    const digest = new DailyDigestService({
      priorities, notifications: deps.notifications,
      dispatch: async (userId, alerts) => { sent.push({ userId, alerts }); },
      withhold: restrictedTodayView(restriction, deps.notes, deps.clients), // the wiring index.ts uses
    });
    await digest.runScheduled([a.r.u, b.r.u], now, { digestHour: 0 });
    const count = (u: string) => Number(/^(\d+)/.exec(sent.find((s) => s.userId === u)?.alerts[0]?.body ?? '0')?.[1] ?? 0);
    const discretionary = (xs: TodayAction[]) => xs.filter((x) => x.kind !== 'meeting').length;
    expect(count(a.r.u)).toBe(discretionary(a.actions)); // the control rep's digest counts the whole cached list
    const shown = (JSON.parse(await get(b.r, '/today')) as { actions: TodayAction[] }).actions;
    expect(JSON.stringify(shown)).not.toContain(MARK);
    expect(count(b.r.u)).toBe(discretionary(shown)); // counts exactly what Today shows under the restriction
    expect(count(b.r.u)).toBeLessThan(count(a.r.u));
  });
});
