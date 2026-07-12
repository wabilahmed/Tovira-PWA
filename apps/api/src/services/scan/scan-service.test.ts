import { describe, it, expect } from 'vitest';
import { ScanService, nextReminderDate } from './scan-service.js';
import { InMemoryClientRepository } from '../../adapters/clients/in-memory-client-repository.js';
import { InMemoryMeetingRepository } from '../../adapters/meetings/in-memory-meeting-repository.js';
import { InMemoryFactsRepository } from '../../adapters/facts/in-memory-facts-repository.js';
import { InMemoryNotificationRepository } from '../../adapters/notifications/in-memory-notification-repository.js';
import type { KeyDateRecord } from '../../ports/facts-repository.js';

function make() {
  const clients = new InMemoryClientRepository();
  const meetings = new InMemoryMeetingRepository();
  const facts = new InMemoryFactsRepository();
  const notifications = new InMemoryNotificationRepository();
  const scan = new ScanService(clients, meetings, facts, notifications);
  return { clients, meetings, facts, notifications, scan };
}

const NOW = Date.parse('2026-07-09T09:00:00Z');
const HOUR = 60 * 60 * 1000;

describe('[P3-2] pre-meeting nudge', () => {
  it('generates a nudge once for a meeting in the lead window', async () => {
    const { clients, meetings, scan, notifications } = make();
    const c = await clients.create('u', 'Meridian');
    await meetings.create('u', { clientId: c.id, datetime: new Date(NOW + 2 * HOUR).toISOString(), datetimeRaw: '2pm', title: null, confirmed: true });
    expect(await scan.nudges('u', NOW, 4 * HOUR)).toBe(1);
    // NEGATIVE: re-running does not double-send.
    expect(await scan.nudges('u', NOW, 4 * HOUR)).toBe(0);
    expect(await notifications.listByUser('u')).toHaveLength(1);
  });

  it('does not nudge for a cancelled (deleted) meeting', async () => {
    const { clients, meetings, scan } = make();
    const c = await clients.create('u', 'Meridian');
    const m = await meetings.create('u', { clientId: c.id, datetime: new Date(NOW + 2 * HOUR).toISOString(), datetimeRaw: '2pm', title: null, confirmed: true });
    await meetings.delete('u', m.id);
    expect(await scan.nudges('u', NOW, 4 * HOUR)).toBe(0);
  });
});

describe('[P3-3] going-cold alert', () => {
  it('alerts a client past the threshold, once', async () => {
    const { clients, scan, notifications } = make();
    const c = await clients.create('u', 'Cold Corp');
    // Force last_touched into the past.
    (c as { lastTouchedAt: number }).lastTouchedAt = NOW - 40 * 24 * HOUR;
    expect(await scan.goingCold('u', NOW, 30)).toBe(1);
    expect(await scan.goingCold('u', NOW, 30)).toBe(0); // idempotent
    expect(await notifications.listByUser('u')).toHaveLength(1);
  });

  it('does not alert a recently-touched client', async () => {
    const { clients, scan } = make();
    await clients.create('u', 'Warm Corp'); // just touched
    expect(await scan.goingCold('u', NOW, 30)).toBe(0);
  });

  it('going-cold list recomputes when the threshold widens', async () => {
    const { clients } = make();
    const c = await clients.create('u', 'Corp');
    (c as { lastTouchedAt: number }).lastTouchedAt = NOW - 20 * 24 * HOUR;
    expect(await clients.listGoingCold('u', NOW - 30 * 24 * HOUR)).toEqual([]); // 30d threshold: not cold
    expect((await clients.listGoingCold('u', NOW - 10 * 24 * HOUR)).map((x) => x.id)).toEqual([c.id]); // 10d: cold
  });
});

describe('[P3-4] date reminders', () => {
  const kd = (over: Partial<KeyDateRecord>): KeyDateRecord => ({
    id: 'd1', userId: 'u', noteId: 'n', clientId: 'c', description: 'Birthday', date: null, dateRaw: null, type: 'birthday', createdAt: 0, ...over,
  });

  it('reminds for a birthday one day out', () => {
    expect(nextReminderDate(kd({ date: '2000-07-10', type: 'birthday' }), NOW, 3)).toBe('2026-07-10');
  });

  // NEGATIVE: a null resolved date never misfires.
  it('never fires for an unresolved (null) date', () => {
    expect(nextReminderDate(kd({ date: null, dateRaw: 'after the holidays' }), NOW, 30)).toBeNull();
  });

  // NEGATIVE: a past one-off does not re-fire.
  it('does not re-fire a past one-off date', () => {
    expect(nextReminderDate(kd({ date: '2026-01-01', type: 'launch' }), NOW, 30)).toBeNull();
  });

  it('reminds for a future one-off within the window', () => {
    expect(nextReminderDate(kd({ date: '2026-07-11', type: 'deadline' }), NOW, 5)).toBe('2026-07-11');
  });

  it('generates a reminder notification idempotently', async () => {
    const { facts, scan, notifications } = make();
    await facts.saveExtraction('u', {
      noteId: 'n', clientId: 'c', promises: [],
      keyDates: [{ description: 'Birthday', date: '2000-07-10', date_raw: 'the 10th', type: 'birthday' }],
    });
    expect(await scan.dateReminders('u', NOW, 3)).toBe(1);
    expect(await scan.dateReminders('u', NOW, 3)).toBe(0);
    expect(await notifications.listByUser('u')).toHaveLength(1);
  });
});
