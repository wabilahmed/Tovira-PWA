import { describe, it, expect } from 'vitest';
import { ScanService, nextReminderDate } from './scan-service.js';
import { InMemoryClientRepository } from '../../adapters/clients/in-memory-client-repository.js';
import { InMemoryMeetingRepository } from '../../adapters/meetings/in-memory-meeting-repository.js';
import { InMemoryFactsRepository } from '../../adapters/facts/in-memory-facts-repository.js';
import { InMemoryNotificationRepository } from '../../adapters/notifications/in-memory-notification-repository.js';
import { InMemoryNoteRepository } from '../../adapters/notes/in-memory-note-repository.js';
import type { KeyDateRecord } from '../../ports/facts-repository.js';
import type { ExtractedPromise } from '../extraction/types.js';

function make() {
  const clients = new InMemoryClientRepository();
  const meetings = new InMemoryMeetingRepository();
  const facts = new InMemoryFactsRepository();
  const notifications = new InMemoryNotificationRepository();
  const notes = new InMemoryNoteRepository();
  const scan = new ScanService(clients, meetings, facts, notifications, notes);
  return { clients, meetings, facts, notifications, notes, scan };
}

const NOW = Date.parse('2026-07-09T09:00:00Z');
const HOUR = 60 * 60 * 1000;

describe('[P4-SILENCE] overdue-promise alerts', () => {
  const prom = (over: Partial<ExtractedPromise>): ExtractedPromise => ({ text: 'Send the quote', owner: 'rep', due_date: null, due_raw: null, confidence: 'high', ...over });

  it('alerts once for a rep promise past its due date, and is idempotent', async () => {
    const { facts, scan, notifications } = make();
    await facts.saveExtraction('u', { noteId: 'n1', clientId: 'c1', promises: [prom({ due_date: '2026-07-01' })] });
    expect(await scan.overduePromises('u', NOW)).toBe(1);
    expect(await scan.overduePromises('u', NOW)).toBe(0); // deduped
    const n = (await notifications.listByUser('u')).find((x) => x.type === 'overdue_promise');
    expect(n).toBeTruthy();
  });

  it('does not alert for a promise due today or in the future', async () => {
    const { facts, scan } = make();
    await facts.saveExtraction('u', { noteId: 'n1', clientId: 'c1', promises: [prom({ due_date: '2026-07-09' })] }); // today
    await facts.saveExtraction('u', { noteId: 'n2', clientId: 'c1', promises: [prom({ due_date: '2026-07-20' })] }); // future
    expect(await scan.overduePromises('u', NOW)).toBe(0);
  });

  it('does not alert for a client-owned promise or one with no resolved date', async () => {
    const { facts, scan } = make();
    await facts.saveExtraction('u', { noteId: 'n1', clientId: 'c1', promises: [prom({ owner: 'client', due_date: '2026-07-01' })] });
    await facts.saveExtraction('u', { noteId: 'n2', clientId: 'c1', promises: [prom({ due_date: null, due_raw: 'after the holidays' })] });
    expect(await scan.overduePromises('u', NOW)).toBe(0);
  });
});

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
    expect(nextReminderDate(kd({ date: '2000-07-10', type: 'birthday' }), '2026-07-09', 3)).toBe('2026-07-10');
  });

  // NEGATIVE: a null resolved date never misfires.
  it('never fires for an unresolved (null) date', () => {
    expect(nextReminderDate(kd({ date: null, dateRaw: 'after the holidays' }), '2026-07-09', 30)).toBeNull();
  });

  // NEGATIVE: a past one-off does not re-fire.
  it('does not re-fire a past one-off date', () => {
    expect(nextReminderDate(kd({ date: '2026-01-01', type: 'launch' }), '2026-07-09', 30)).toBeNull();
  });

  it('reminds for a future one-off within the window', () => {
    expect(nextReminderDate(kd({ date: '2026-07-11', type: 'deadline' }), '2026-07-09', 5)).toBe('2026-07-11');
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

const DAY = 24 * 60 * 60 * 1000;

describe('chatRefreshNudges (P3-7)', () => {
  async function seedImport(userId: string) {
    const { clients, notes, notifications, scan } = make();
    const c = await clients.create(userId, 'Sara Lee');
    await notes.create(userId, { clientId: c.id, source: 'whatsapp_export', rawText: 't', audioKey: null, status: 'extracted', messages: [] });
    return { clients, notes, notifications, scan, clientId: c.id };
  }

  it('nudges a client whose last import has gone stale, naming the client', async () => {
    const { scan, notifications } = await seedImport('u');
    const future = Date.now() + 100 * DAY; // well past the 21-day staleness gap
    expect(await scan.chatRefreshNudges('u', future, 21)).toBe(1);
    const [n] = await notifications.listByUser('u');
    expect(n!.type).toBe('chat_refresh');
    expect(n!.body).toMatch(/sara lee/i);
  });

  it('does not nudge a recently-imported client (respects the gap)', async () => {
    const { scan } = await seedImport('u');
    expect(await scan.chatRefreshNudges('u', Date.now() + 1 * DAY, 21)).toBe(0);
  });

  it('is idempotent — does not re-fire daily for the same stale import', async () => {
    const { scan, notifications } = await seedImport('u');
    const future = Date.now() + 100 * DAY;
    expect(await scan.chatRefreshNudges('u', future, 21)).toBe(1);
    expect(await scan.chatRefreshNudges('u', future + DAY, 21)).toBe(0); // next day → no new nudge
    expect(await notifications.listByUser('u')).toHaveLength(1);
  });

  it('never nudges a client that was never imported', async () => {
    const { clients, scan } = make();
    await clients.create('u', 'No Import Co');
    expect(await scan.chatRefreshNudges('u', Date.now() + 100 * DAY, 21)).toBe(0);
  });

  it('does not leak refresh nudges across tenants', async () => {
    const { scan, notifications } = await seedImport('a');
    await scan.chatRefreshNudges('a', Date.now() + 100 * DAY, 21);
    expect(await notifications.listByUser('b')).toEqual([]);
  });
});
