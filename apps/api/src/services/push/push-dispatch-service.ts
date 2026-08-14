import type { PushBudgetRepository, PushSender, PushSubscriptionRepository } from '../../ports/push.js';
import type { NotificationRepository, NotificationType } from '../../ports/notification-repository.js';

/**
 * The silence budget (P4-SILENCE). A rep gets at most {@link DAILY_PUSH_CAP}
 * pushes per day — capture friction, and interruption friction, kill the
 * product. When more alerts qualify than the budget allows, the LOUDEST ones win
 * (an overdue promise outranks a "going quiet" nudge outranks a meeting reminder
 * outranks a date outranks a refresh nudge), and the rest are SUPPRESSED FROM
 * PUSH ONLY — every alert still lands in the in-app Alerts list, so nothing is
 * lost, it just doesn't buzz the phone. The cap is enforced here, at the single
 * send path, and counts alerts (not per-device fan-out).
 */
export const DAILY_PUSH_CAP = 2;

/** Push priority, lowest number = loudest. Types outside this map never preempt. */
const RANK: Record<string, number> = {
  overdue_promise: 0,
  going_cold: 1,
  pre_meeting_nudge: 2,
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
  ) {}

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

    // 2. Rank, then spend only what today's budget allows.
    const ranked = [...candidates].sort((a, b) => rankOf(a.type) - rankOf(b.type));
    const day = dayKey(nowMs);
    const remaining = Math.max(0, this.cap - (await this.budget.countSent(userId, day)));
    const devices = await this.subs.listByUser(userId);
    const canSend = devices.length > 0 ? remaining : 0;
    const sent = ranked.slice(0, canSend);
    const suppressed = ranked.slice(sent.length);

    for (const alert of sent) {
      for (const device of devices) {
        await this.sender.send(device, { title: alert.title, body: alert.body, ...(alert.url ? { url: alert.url } : {}) });
      }
    }
    if (sent.length > 0) await this.budget.recordSent(userId, day, sent.length);

    return { sent, suppressed };
  }
}
