import type { PushSender, PushSubscriptionRepository } from '../../ports/push.js';
import type { NotificationRepository, NotificationType } from '../../ports/notification-repository.js';

/**
 * Push dispatch (NOTIF-REWORK). The two-per-day silence budget and its ranking-for-scarcity logic
 * are REMOVED (owner product decision).
 *
 * - TIME-CRITICAL alerts push the moment they fire, UNCAPPED: `pre_meeting_nudge`,
 *   `promise_due_today`, `import_complete` (and `daily_digest`, added in Task 3 — the one
 *   discretionary push). Three meetings tomorrow = three nudges.
 * - DISCRETIONARY alerts (`overdue_promise`, `going_cold`, `date_reminder`, `chat_refresh`) are
 *   still RECORDED in-app (nothing is lost) but are NEVER pushed individually. They surface in the
 *   daily list and are announced once by the daily digest (DailyDigestService). This is what stops a
 *   large import turning into a push flood — the risk that made reps silence notifications at the OS
 *   level, which would also kill the meeting nudges.
 *
 * Per-alert dedup is preserved: `createIfAbsent` is idempotent by dedupeKey, and the emitters only
 * enqueue alerts that were newly created — so the same meeting never nudges twice.
 */

/** Alert types that push immediately, with no daily limit. Everything else is recorded in-app only. */
export const TIME_CRITICAL: ReadonlySet<string> = new Set<NotificationType>([
  'pre_meeting_nudge',
  'promise_due_today',
  'import_complete',
  // 'daily_digest' is added in Task 3 (the one discretionary push).
]);

export interface PushableAlert {
  type: NotificationType;
  dedupeKey: string;
  clientId: string | null;
  title: string;
  body: string;
  url?: string;
}

export interface DispatchResult {
  /** Time-critical alerts actually pushed to a device this call. */
  sent: PushableAlert[];
  /** Discretionary alerts recorded in-app but intentionally NOT pushed (the daily digest carries them). */
  heldForDigest: PushableAlert[];
}

export class PushDispatchService {
  constructor(
    private readonly sender: PushSender,
    private readonly subs: PushSubscriptionRepository,
    private readonly notifications: NotificationRepository,
  ) {}

  /**
   * Record every candidate as an in-app alert (idempotent), then push ONLY the time-critical ones —
   * uncapped. Discretionary candidates are recorded and returned in `heldForDigest`, never pushed.
   */
  async dispatch(userId: string, candidates: PushableAlert[], _nowMs?: number): Promise<DispatchResult> {
    // 1. Record ALL candidates in-app first — a not-pushed alert is never a lost alert.
    for (const c of candidates) {
      await this.notifications.createIfAbsent(userId, {
        type: c.type,
        dedupeKey: c.dedupeKey,
        clientId: c.clientId,
        title: c.title,
        body: c.body,
      });
    }

    const pushable = candidates.filter((c) => TIME_CRITICAL.has(c.type));
    const heldForDigest = candidates.filter((c) => !TIME_CRITICAL.has(c.type));

    const devices = await this.subs.listByUser(userId);
    if (devices.length > 0) {
      for (const alert of pushable) {
        for (const device of devices) {
          await this.sender.send(device, { title: alert.title, body: alert.body, ...(alert.url ? { url: alert.url } : {}) });
        }
      }
    }

    return { sent: devices.length > 0 ? pushable : [], heldForDigest };
  }
}
