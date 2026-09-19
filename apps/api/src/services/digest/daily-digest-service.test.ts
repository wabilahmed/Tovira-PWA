import { describe, it, expect, vi } from 'vitest';
import { DailyDigestService } from './daily-digest-service.js';
import { InMemoryNotificationRepository } from '../../adapters/notifications/in-memory-notification-repository.js';
import type { PrioritiesRepository, PrioritiesRecord } from '../../ports/priorities-repository.js';
import type { TodayAction } from '../hero/hero-service.js';
import type { PushableAlert } from '../push/push-dispatch-service.js';

// 2026-08-14 09:00Z — past the default 08:00 digest hour in UTC.
const NOW = Date.parse('2026-08-14T09:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

const REASON: Record<TodayAction['kind'], TodayAction['reason']> = { promise: 'promise_overdue', meeting: 'meeting', cold: 'cooling', match: 'match', risk: 'cooling' };
const act = (kind: TodayAction['kind'], n: number): TodayAction => ({ kind, reason: REASON[kind], priority: 1, text: `${kind} ${n}`, clientId: String(n) });

/** A priorities cache stub: returns the given actions for the queried day; records get() calls. */
function cacheOf(actions: TodayAction[]): PrioritiesRepository & { getSpy: ReturnType<typeof vi.fn> } {
  const rec: PrioritiesRecord | null = actions.length >= 0 ? { userId: 'u', day: '', actions, refreshCount: 0, computedAt: 0 } : null;
  const getSpy = vi.fn(async (_userId: string, day: string) => (rec ? { ...rec, day } : null));
  return { get: getSpy, save: vi.fn(async () => {}), getSpy };
}

function make(actions: TodayAction[]) {
  const notifications = new InMemoryNotificationRepository();
  const dispatch = vi.fn(async (userId: string, alerts: PushableAlert[]) => {
    // mirror the real dispatcher's in-app record so idempotency holds across runs
    for (const a of alerts) await notifications.createIfAbsent(userId, { type: a.type, dedupeKey: a.dedupeKey, clientId: a.clientId, title: a.title, body: a.body });
  });
  const priorities = cacheOf(actions);
  const svc = new DailyDigestService({ priorities, notifications, dispatch });
  return { svc, dispatch, notifications, priorities };
}

describe('[NOTIF-REWORK Task 3] daily digest', () => {
  it('six discretionary findings produce ONE push, not six', async () => {
    const { svc, dispatch } = make([act('cold', 1), act('cold', 2), act('promise', 3), act('match', 4), act('cold', 5), act('promise', 6)]);
    const sent = await svc.runScheduled(['u'], NOW);
    expect(sent).toBe(1);
    expect(dispatch).toHaveBeenCalledTimes(1);
    const alert = dispatch.mock.calls[0]![1][0]!;
    expect(alert.type).toBe('daily_digest');
    expect(alert.body).toBe('6 things need you');
    expect(alert.url).toBe('/today');
  });

  it('one finding uses the singular', async () => {
    const { svc, dispatch } = make([act('cold', 1)]);
    await svc.runScheduled(['u'], NOW);
    expect(dispatch.mock.calls[0]![1][0]!.body).toBe('1 thing needs you');
  });

  it('zero discretionary findings produce ZERO pushes (empty digest is worse than silence)', async () => {
    const { svc, dispatch } = make([]);
    expect(await svc.runScheduled(['u'], NOW)).toBe(0);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('a meetings-only day does not digest (meetings are time-critical, pushed individually)', async () => {
    const { svc, dispatch } = make([act('meeting', 1), act('meeting', 2)]);
    expect(await svc.runScheduled(['u'], NOW)).toBe(0);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('READS the precomputed cache and does not recompute (asserts the cache source)', async () => {
    const { svc, priorities, dispatch } = make([act('cold', 1), act('promise', 2)]);
    await svc.runScheduled(['u'], NOW);
    expect(priorities.getSpy).toHaveBeenCalledTimes(1); // the count came from priorities.get, not a fresh computation
    expect(dispatch.mock.calls[0]![1][0]!.body).toBe('2 things need you');
  });

  it('is idempotent per rep-day: a second run the same day does not push again', async () => {
    const { svc, dispatch } = make([act('cold', 1), act('cold', 2)]);
    expect(await svc.runScheduled(['u'], NOW)).toBe(1);
    expect(await svc.runScheduled(['u'], NOW + 60 * 1000)).toBe(0); // same day → no second digest
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it('does not fire before the rep\'s local digest hour', async () => {
    const { svc, dispatch } = make([act('cold', 1)]);
    const early = Date.parse('2026-08-14T05:00:00Z'); // 05:00 UTC < 08:00 default
    expect(await svc.runScheduled(['u'], early)).toBe(0);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('no cached row yet → no push (never triggers a computation to fill it)', async () => {
    const notifications = new InMemoryNotificationRepository();
    const dispatch = vi.fn(async () => {});
    const priorities: PrioritiesRepository = { get: vi.fn(async () => null), save: vi.fn(async () => {}) };
    const svc = new DailyDigestService({ priorities, notifications, dispatch });
    expect(await svc.runScheduled(['u'], NOW)).toBe(0);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('fires the next day after resetting (new dedupe key)', async () => {
    const { svc, dispatch } = make([act('cold', 1)]);
    await svc.runScheduled(['u'], NOW);
    await svc.runScheduled(['u'], NOW + DAY);
    expect(dispatch).toHaveBeenCalledTimes(2);
  });
});
