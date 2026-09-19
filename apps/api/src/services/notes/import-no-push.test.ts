import { describe, it, expect, vi } from 'vitest';
import { PushDispatchService, type PushableAlert } from '../push/push-dispatch-service.js';
import { ScanService } from '../scan/scan-service.js';
import { HeroService } from '../hero/hero-service.js';
import { BookScanService } from '../book-scan/book-scan-service.js';
import { InMemoryFactsRepository } from '../../adapters/facts/in-memory-facts-repository.js';
import { InMemoryClientRepository } from '../../adapters/clients/in-memory-client-repository.js';
import { InMemoryMeetingRepository } from '../../adapters/meetings/in-memory-meeting-repository.js';
import { InMemoryNotificationRepository } from '../../adapters/notifications/in-memory-notification-repository.js';
import { InMemoryNoteRepository } from '../../adapters/notes/in-memory-note-repository.js';
import { InMemoryPushSubscriptionRepository } from '../../adapters/push/in-memory-push-subscription-repository.js';
import type { PushSender } from '../../ports/push.js';
import type { ExtractedPromise } from '../extraction/types.js';

/**
 * [NOTIF-REWORK Task 4] Imports never push beyond the single import-complete notice. Findings from
 * an import (overdue promises, cooling clients, key dates …) are DISCRETIONARY — recorded in-app,
 * surfaced in the daily list and the Book Scan, announced once by the daily digest — never an
 * individual push. So importing a year of history cannot flood the phone.
 */

const NOW = Date.parse('2026-08-14T09:00:00Z');
const sub = { endpoint: 'https://push.test/a', keys: { p256dh: 'k', auth: 'a' } };
const overdue = (n: number): ExtractedPromise => ({ text: `promise ${n}`, owner: 'rep', due_date: '2026-08-01', due_raw: null, confidence: 'high' });

describe('[NOTIF-REWORK Task 4] an import emits only the import-complete notice', () => {
  it('200 discretionary findings + one import-complete → exactly ONE push (the notice), nothing else', async () => {
    const sender: PushSender = { send: vi.fn().mockResolvedValue(undefined) };
    const notifications = new InMemoryNotificationRepository();
    const subs = new InMemoryPushSubscriptionRepository();
    await subs.save('u', sub);
    const dispatch = new PushDispatchService(sender, subs, notifications);

    // The findings an import surfaces (all discretionary), plus the one import-complete notice.
    const findings: PushableAlert[] = Array.from({ length: 200 }, (_, i) => ({
      type: 'overdue_promise', dedupeKey: `promise:${i}`, clientId: 'c1', title: 'Overdue promise', body: `overdue ${i}`,
    }));
    const notice: PushableAlert = { type: 'import_complete', dedupeKey: 'import:n1', clientId: 'c1', title: 'Import complete', body: 'Imported 1 chat' };

    const { sent, heldForDigest } = await dispatch.dispatch('u', [...findings, notice]);
    expect(sender.send).toHaveBeenCalledTimes(1); // only the import-complete notice buzzed the phone
    expect(sent.map((a) => a.type)).toEqual(['import_complete']);
    expect(heldForDigest).toHaveLength(200); // every finding held for the digest, not pushed
    expect(await notifications.listByUser('u')).toHaveLength(201); // all recorded in-app (nothing lost)
  });
});

describe('[NOTIF-REWORK Task 4] import findings land in the daily list and Book Scan', () => {
  it('overdue promises from an import appear in the daily list (hero) and the Book Scan register', async () => {
    const clients = new InMemoryClientRepository();
    const facts = new InMemoryFactsRepository();
    const meetings = new InMemoryMeetingRepository();
    const notes = new InMemoryNoteRepository();
    const c = await clients.create('u', 'Imported Co');
    // A chat import produced these facts (overdue promises).
    await facts.saveExtraction('u', { noteId: 'n1', clientId: c.id, captureAt: '2026-07-15', promises: [overdue(1), overdue(2), overdue(3)] });

    const hero = new HeroService({ clients, facts, meetings, notes }, { minClients: 0, minNotes: 0 }, 30, 90);
    const today = await hero.today('u', NOW);
    expect(today.some((a) => a.kind === 'promise')).toBe(true); // in the daily list

    const bookScan = new BookScanService({ clients, notes, facts }, { coldThresholdDays: 30, upcomingWindowDays: 30, promiseStaleThresholdDays: 90 });
    const report = await bookScan.scan('u', NOW);
    expect(report.items.filter((i) => i.kind === 'open_promise').length).toBeGreaterThanOrEqual(3); // in the Book Scan
  });

  it('a scan over imported facts pushes nothing individually (discretionary → digest)', async () => {
    const clients = new InMemoryClientRepository();
    const facts = new InMemoryFactsRepository();
    const meetings = new InMemoryMeetingRepository();
    const notifications = new InMemoryNotificationRepository();
    const notes = new InMemoryNoteRepository();
    const c = await clients.create('u', 'Imported Co');
    await facts.saveExtraction('u', { noteId: 'n1', clientId: c.id, promises: [overdue(1), overdue(2)] });

    const scan = new ScanService(clients, meetings, facts, notifications, notes);
    const summary = await scan.runAll('u', NOW, { coldThresholdDays: 30, nudgeLeadMs: 2 * 60 * 60 * 1000, reminderWindowDays: 30, chatRefreshStaleDays: 21 });
    // The overdue promises are pushables, but every one is discretionary — none is time-critical.
    const sender: PushSender = { send: vi.fn().mockResolvedValue(undefined) };
    const subs = new InMemoryPushSubscriptionRepository();
    await subs.save('u', sub);
    const dispatch = new PushDispatchService(sender, subs, notifications);
    const { sent } = await dispatch.dispatch('u', summary.pushables);
    expect(summary.overduePromises).toBe(2);
    expect(sent).toHaveLength(0); // nothing pushed individually from the import's findings
    expect(sender.send).not.toHaveBeenCalled();
  });
});

// A promise DUE TODAY is time-critical by design (ruling) — but a year-of-history import surfaces
// past-due promises, not due-today ones, so this does not turn a historical import into a push.
describe('[NOTIF-REWORK Task 4] sanity: a historical import produces no due-today (time-critical) pushables', () => {
  it('past-due promises are overdue (discretionary), never promise_due_today', async () => {
    const clients = new InMemoryClientRepository();
    const facts = new InMemoryFactsRepository();
    const meetings = new InMemoryMeetingRepository();
    const notifications = new InMemoryNotificationRepository();
    const notes = new InMemoryNoteRepository();
    const c = await clients.create('u', 'Imported Co');
    await facts.saveExtraction('u', { noteId: 'n1', clientId: c.id, promises: [overdue(1)] }); // due 2026-08-01, well before NOW
    const scan = new ScanService(clients, meetings, facts, notifications, notes);
    const dueToday = await scan.promisesDueToday('u', NOW);
    expect(dueToday).toBe(0); // nothing due exactly today → no time-critical push from the import
  });
});
