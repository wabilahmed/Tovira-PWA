/**
 * Port: generated alerts/reminders (P3-2/3/4). Stored so they're idempotent
 * (deduped by key) and reachable in-app even when push fails/is off (P3-5).
 */
export type NotificationType =
  | 'overdue_promise'
  | 'promise_due_today' // NOTIF-REWORK: time-critical — a rep-owned promise due TODAY (pushes uncapped)
  | 'pre_meeting_nudge'
  | 'going_cold'
  | 'date_reminder'
  | 'chat_refresh'
  | 'monday_digest'
  | 'daily_digest' // NOTIF-REWORK: the one discretionary push — "N things need you" (opens the daily list)
  | 'erasure_pending' // ERASURE: a third party requested erasure; the rep's retention-window notice (Terms 4.9)
  | 'erasure_completed' // ERASURE: the erasure ran; what was removed, in categories
  | 'import_complete';

export interface NotificationEntry {
  type: NotificationType;
  dedupeKey: string; // unique per user — re-runs won't duplicate
  clientId: string | null;
  title: string;
  body: string;
}

export interface NotificationRecord extends NotificationEntry {
  id: string;
  userId: string;
  read: boolean;
  createdAt: number;
}

export interface NotificationRepository {
  /** Create unless one with the same dedupeKey exists. Returns true if created. */
  createIfAbsent(userId: string, entry: NotificationEntry): Promise<boolean>;
  listByUser(userId: string): Promise<NotificationRecord[]>;
  markRead(userId: string, id: string): Promise<boolean>;
}
