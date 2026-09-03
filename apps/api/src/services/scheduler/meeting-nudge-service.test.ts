import { describe, it, expect } from 'vitest';
import { MeetingNudgeService } from './meeting-nudge-service.js';
import { ScanService } from '../scan/scan-service.js';
import type { PushableAlert } from '../push/push-dispatch-service.js';
import { InMemoryClientRepository } from '../../adapters/clients/in-memory-client-repository.js';
import { InMemoryMeetingRepository } from '../../adapters/meetings/in-memory-meeting-repository.js';
import { InMemoryFactsRepository } from '../../adapters/facts/in-memory-facts-repository.js';
import { InMemoryNotificationRepository } from '../../adapters/notifications/in-memory-notification-repository.js';
import { InMemoryNoteRepository } from '../../adapters/notes/in-memory-note-repository.js';

const NOW = Date.parse('2026-07-09T09:00:00Z');
const HOUR = 60 * 60 * 1000;
const MIN = 60 * 1000;
const WINDOW = 2 * HOUR + 15 * MIN; // A2 decision: 2h ± 15m → fire when start is within (lead+tolerance)

function harness() {
  const clients = new InMemoryClientRepository();
  const meetings = new InMemoryMeetingRepository();
  const facts = new InMemoryFactsRepository();
  const notifications = new InMemoryNotificationRepository();
  const notes = new InMemoryNoteRepository();
  const scan = new ScanService(clients, meetings, facts, notifications, notes);
  const users = new Set<string>();
  const dispatched: { userId: string; alerts: PushableAlert[] }[] = [];
  const svc = new MeetingNudgeService({
    allUserIds: async () => [...users],
    generate: (u, now, win, sink) => scan.nudges(u, now, win, sink),
    dispatch: async (u, alerts) => { dispatched.push({ userId: u, alerts }); },
    windowMs: WINDOW,
  });
  async function meeting(userId: string, startMs: number): Promise<string> {
    users.add(userId);
    const c = await clients.create(userId, 'Meridian');
    const m = await meetings.create(userId, { clientId: c.id, datetime: new Date(startMs).toISOString(), datetimeRaw: 'raw', title: null, confirmed: true });
    return m.id;
  }
  const nudgeCount = async (u: string): Promise<number> => (await notifications.listByUser(u)).filter((n) => n.type === 'pre_meeting_nudge').length;
  return { meetings, notifications, users, svc, dispatched, meeting, nudgeCount };
}

describe('[NUDGE-SCHED] meeting-nudges on the frequent brain', () => {
  it('nudges a meeting ~2h out, once, and is idempotent across runs', async () => {
    const h = harness();
    await h.meeting('u', NOW + 2 * HOUR);
    await h.svc.run(NOW);
    expect(h.dispatched).toHaveLength(1);
    expect(h.dispatched[0]).toMatchObject({ userId: 'u' });
    expect(h.dispatched[0]?.alerts).toHaveLength(1);
    expect(h.dispatched[0]?.alerts[0]?.type).toBe('pre_meeting_nudge');
    // Idempotent: a second run (same or later tick) does not re-send.
    await h.svc.run(NOW + MIN);
    expect(h.dispatched).toHaveLength(1);
    expect(await h.nudgeCount('u')).toBe(1);
  });

  it('does NOT nudge a meeting well outside the window (5h out)', async () => {
    const h = harness();
    await h.meeting('u', NOW + 5 * HOUR);
    await h.svc.run(NOW);
    expect(h.dispatched).toHaveLength(0);
  });

  it('nudges immediately (next tick) a meeting created less than 2h before it starts', async () => {
    const h = harness();
    await h.meeting('u', NOW + 45 * MIN); // logged 45m before a meeting → still gets the brief
    await h.svc.run(NOW);
    expect(h.dispatched).toHaveLength(1);
    expect(h.dispatched[0]?.alerts[0]?.type).toBe('pre_meeting_nudge');
  });

  it('does NOT nudge a meeting whose start is already in the past (retroactive)', async () => {
    const h = harness();
    await h.meeting('u', NOW - 30 * MIN); // start already elapsed → nothing to prepare for
    await h.svc.run(NOW);
    expect(h.dispatched).toHaveLength(0);
  });

  it('respects the window boundary: exactly at (lead+tolerance) is in, one ms past is out', async () => {
    const h = harness();
    await h.meeting('in', NOW + WINDOW); // exactly on the edge → included
    await h.meeting('out', NOW + WINDOW + 1); // just past → excluded
    await h.svc.run(NOW);
    const users = h.dispatched.map((d) => d.userId);
    expect(users).toContain('in');
    expect(users).not.toContain('out');
  });

  it('isolates per rep: one rep\'s meeting never dispatches to another', async () => {
    const h = harness();
    await h.meeting('a', NOW + 2 * HOUR);
    h.users.add('b'); // b exists but has no meeting
    await h.svc.run(NOW);
    expect(h.dispatched).toHaveLength(1);
    expect(h.dispatched[0]?.userId).toBe('a');
  });

  it('reschedule BEFORE the nudge fires → the nudge follows the new time', async () => {
    const h = harness();
    const id = await h.meeting('u', NOW + 5 * HOUR); // outside the window
    await h.svc.run(NOW);
    expect(h.dispatched).toHaveLength(0);
    await h.meetings.update('u', id, { datetime: new Date(NOW + 2 * HOUR).toISOString() }); // now within window
    await h.svc.run(NOW);
    expect(h.dispatched).toHaveLength(1);
  });

  it('reschedule AFTER the nudge fired → no second nudge (one per meeting)', async () => {
    const h = harness();
    const id = await h.meeting('u', NOW + 2 * HOUR);
    await h.svc.run(NOW);
    expect(h.dispatched).toHaveLength(1);
    await h.meetings.update('u', id, { datetime: new Date(NOW + 2 * HOUR + 30 * MIN).toISOString() }); // moved same day
    await h.svc.run(NOW + MIN);
    expect(h.dispatched).toHaveLength(1); // still just the one
  });

  it('deleting a meeting cancels a pending nudge', async () => {
    const h = harness();
    const id = await h.meeting('u', NOW + 2 * HOUR);
    await h.meetings.delete('u', id);
    await h.svc.run(NOW);
    expect(h.dispatched).toHaveLength(0);
  });

  it('moving a meeting into the past cancels the nudge', async () => {
    const h = harness();
    const id = await h.meeting('u', NOW + 2 * HOUR);
    await h.meetings.update('u', id, { datetime: new Date(NOW - 30 * MIN).toISOString() });
    await h.svc.run(NOW);
    expect(h.dispatched).toHaveLength(0);
  });

  it('carries composed content (client · time · top item + deep link) when signalsFor is provided', async () => {
    const clients = new InMemoryClientRepository();
    const meetings = new InMemoryMeetingRepository();
    const facts = new InMemoryFactsRepository();
    const notifications = new InMemoryNotificationRepository();
    const notes = new InMemoryNoteRepository();
    const scan = new ScanService(clients, meetings, facts, notifications, notes);
    const alerts: PushableAlert[] = [];
    const c = await clients.create('u', 'Meridian');
    await meetings.create('u', { clientId: c.id, datetime: new Date(NOW + 2 * HOUR).toISOString(), datetimeRaw: '3pm', title: null, confirmed: true });
    const svc = new MeetingNudgeService({
      allUserIds: async () => ['u'],
      generate: (u, now, win, sink, compose) => scan.nudges(u, now, win, sink, compose),
      signalsFor: async (_u, m) => ({ clientName: 'Meridian', clientId: m.clientId, whenLabel: 'today at 3:00 PM', topPromise: 'send the quote' }),
      dispatch: async (_u, a) => { alerts.push(...a); },
      windowMs: WINDOW,
    });
    await svc.run(NOW);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.title).toBe('Meridian');
    expect(alerts[0]?.body).toBe('today at 3:00 PM · Open promise — send the quote');
    expect(alerts[0]?.url).toBe(`/app?client=${c.id}`);
  });
});
