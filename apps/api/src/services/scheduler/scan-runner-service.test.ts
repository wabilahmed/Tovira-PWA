import { describe, it, expect } from 'vitest';
import { ScanRunnerService } from './scan-runner-service.js';
import { ScanService } from '../scan/scan-service.js';
import type { PushableAlert } from '../push/push-dispatch-service.js';
import { InMemoryClientRepository } from '../../adapters/clients/in-memory-client-repository.js';
import { InMemoryMeetingRepository } from '../../adapters/meetings/in-memory-meeting-repository.js';
import { InMemoryFactsRepository } from '../../adapters/facts/in-memory-facts-repository.js';
import { InMemoryNotificationRepository } from '../../adapters/notifications/in-memory-notification-repository.js';
import { InMemoryNoteRepository } from '../../adapters/notes/in-memory-note-repository.js';
import type { ExtractedPromise } from '../extraction/types.js';

const NOW = Date.parse('2026-08-14T09:00:00Z');
const CFG = { coldThresholdDays: 30, nudgeLeadMs: 2 * 60 * 60 * 1000, reminderWindowDays: 7, chatRefreshStaleDays: 21 };
const prom = (over: Partial<ExtractedPromise>): ExtractedPromise => ({ text: 'Send the quote', owner: 'rep', due_date: null, due_raw: null, confidence: 'high', ...over });

function harness() {
  const clients = new InMemoryClientRepository();
  const meetings = new InMemoryMeetingRepository();
  const facts = new InMemoryFactsRepository();
  const notifications = new InMemoryNotificationRepository();
  const notes = new InMemoryNoteRepository();
  const scan = new ScanService(clients, meetings, facts, notifications, notes);
  const users = new Set<string>();
  const dispatched: { userId: string; alerts: PushableAlert[] }[] = [];
  const runner = new ScanRunnerService({
    allUserIds: async () => [...users],
    runAll: (u, now) => scan.runAll(u, now, CFG),
    dispatch: async (u, alerts) => { dispatched.push({ userId: u, alerts }); },
  });
  return { clients, facts, notifications, users, runner, dispatched };
}

describe('[SCAN-WIRING] the daily scan runs on the brain, per rep', () => {
  it('scans every rep and dispatches their overdue-promise alerts', async () => {
    const h = harness();
    h.users.add('a'); h.users.add('b');
    await h.facts.saveExtraction('a', { noteId: 'n1', clientId: 'c1', promises: [prom({ due_date: '2026-07-01' })] }); // overdue
    await h.runner.run(NOW);
    expect(h.dispatched.map((d) => d.userId)).toEqual(['a']); // only the rep with an alert
    expect(h.dispatched[0]?.alerts.some((x) => x.type === 'overdue_promise')).toBe(true);
  });

  it('is idempotent: a second run the same day generates no new alert (deduped)', async () => {
    const h = harness();
    h.users.add('a');
    await h.facts.saveExtraction('a', { noteId: 'n1', clientId: 'c1', promises: [prom({ due_date: '2026-07-01' })] });
    await h.runner.run(NOW);
    expect(h.dispatched).toHaveLength(1);
    await h.runner.run(NOW + 60_000);
    expect(h.dispatched).toHaveLength(1); // nothing new to push — createIfAbsent deduped it
  });

  it('a rep with nothing to flag is not dispatched to', async () => {
    const h = harness();
    h.users.add('quiet');
    await h.runner.run(NOW);
    expect(h.dispatched).toHaveLength(0);
  });
});
