/**
 * Port: generated alerts/reminders (P3-2/3/4). Stored so they're idempotent
 * (deduped by key) and reachable in-app even when push fails/is off (P3-5).
 */
export type NotificationType = 'pre_meeting_nudge' | 'going_cold' | 'date_reminder';

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
