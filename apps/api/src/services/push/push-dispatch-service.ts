import type { PushBudgetRepository, PushSender, PushSubscriptionRepository } from '../../ports/push.js';
import type { NotificationRepository, NotificationType } from '../../ports/notification-repository.js';
import { zonedTodayIso } from '../time/zone.js';

/**
 * The silence budget (P4-SILENCE). A rep gets at most {@link DAILY_PUSH_CAP} NON-MEETING
 * pushes per day — capture friction, and interruption friction, kill the product. When more
 * qualify than the budget allows, the LOUDEST win and the rest are SUPPRESSED FROM PUSH ONLY —
 * every alert still lands in the in-app Alerts list, so nothing is lost, it just doesn't buzz
 * the phone. The cap counts alerts (not per-device fan-out).
 *
 * [NUDGE-RANK] Pre-meeting nudges are the FIRST exception to brand §10's 2/day cap — the only alert
 * with a deadline (a brief is worthless after the meeting), so a rep with three meetings gets three
 * nudges: always sent, never suppressed by the cap, never consuming it.
 *
 * [IMPORT-DONE] Import-complete notices are the SECOND documented exception. An import notice is a
 * RESPONSE to something the rep just did and is actively waiting on — not proactive noise — so, by
 * the same reasoning that exempted meeting nudges, it is always sent and never consumes the budget.
 * Everything else still shares the cap of 2.
 */
export const DAILY_PUSH_CAP = 2;

/** Alert types exempt from the 2/day budget — never suppressed, never consuming it (see above). */
const EXEMPT: ReadonlySet<string> = new Set(['pre_meeting_nudge', 'import_complete']);

/** Push priority, lowest number = loudest. Time-critical beats important, so the meeting
 *  nudge outranks all. Types outside this map never preempt. */
const RANK: Record<string, number> = {
  pre_meeting_nudge: 0,
  import_complete: 0, // exempt + loud: the rep is actively waiting on it
  overdue_promise: 1,
  going_cold: 2,
  date_reminder: 3,
  chat_refresh: 4,
  monday_digest: 5,
};
const rankOf = (type: string): number => RANK[type] ?? 99;

export interface PushableAlert {
  type: NotificationType;
  dedupeKey: string;
  clientId: string | null;
  title: string;
  body: string;
  url?: string;
}

export interface DispatchResult {
  sent: PushableAlert[];
  suppressed: PushableAlert[];
}

function dayKey(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10); // UTC day
}

export class PushDispatchService {
  constructor(
    private readonly sender: PushSender,
    private readonly subs: PushSubscriptionRepository,
    private readonly notifications: NotificationRepository,
    private readonly budget: PushBudgetRepository,
    private readonly cap: number = DAILY_PUSH_CAP,
    /** [TZ-BOUNDARY] the 2/day silence budget resets on the REP's day, not 00:00 UTC. */
    private readonly timezoneFor?: (userId: string) => Promise<string>,
  ) {}

  private async dayFor(userId: string, nowMs: number): Promise<string> {
    if (!this.timezoneFor) return dayKey(nowMs);
    return zonedTodayIso(await this.timezoneFor(userId), new Date(nowMs));
  }

  /**
   * Record every candidate as an in-app alert (idempotent), then push the
   * highest-priority ones that still fit today's budget. Returns which were
   * pushed vs. suppressed-from-push.
   */
  async dispatch(userId: string, candidates: PushableAlert[], nowMs: number): Promise<DispatchResult> {
    // 1. A suppressed push is never a lost alert — record ALL of them in-app first.
    for (const c of candidates) {
      await this.notifications.createIfAbsent(userId, {
        type: c.type,
        dedupeKey: c.dedupeKey,
        clientId: c.clientId,
        title: c.title,
        body: c.body,
      });
    }

    // 2. Split: exempt alerts (meeting nudges + import-complete) are outside the cap; the rest share it.
    const exempt = candidates.filter((c) => EXEMPT.has(c.type));
    const others = candidates
      .filter((c) => !EXEMPT.has(c.type))
      .sort((a, b) => rankOf(a.type) - rankOf(b.type));

    const day = await this.dayFor(userId, nowMs);
    const devices = await this.subs.listByUser(userId);
    const hasDevices = devices.length > 0;

    // Non-exempt alerts spend today's budget; exempt ones never touch it.
    const remaining = Math.max(0, this.cap - (await this.budget.countSent(userId, day)));
    const othersToSend = hasDevices ? others.slice(0, remaining) : [];
    const exemptToSend = hasDevices ? exempt : [];

    // Loudest first for the returned order (exempt types rank 0, so ahead of the rest).
    const sent = [...exemptToSend, ...othersToSend].sort((a, b) => rankOf(a.type) - rankOf(b.type));
    const suppressed = others.slice(othersToSend.length); // exempt alerts are never suppressed by the cap

    for (const alert of sent) {
      for (const device of devices) {
        await this.sender.send(device, { title: alert.title, body: alert.body, ...(alert.url ? { url: alert.url } : {}) });
      }
    }
    // Only NON-exempt sends consume the daily budget (the documented brand §10 exceptions).
    if (othersToSend.length > 0) await this.budget.recordSent(userId, day, othersToSend.length);

    return { sent, suppressed };
  }
}
