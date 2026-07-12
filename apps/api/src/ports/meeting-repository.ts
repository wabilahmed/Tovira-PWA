/**
 * Port: the rep's internal calendar (P3-1). Tenant-scoped; Postgres enforces RLS.
 */

export interface MeetingRecord {
  id: string;
  userId: string;
  clientId: string;
  datetime: string | null; // resolved ISO datetime, or null if unresolved
  datetimeRaw: string;
  title: string | null;
  confirmed: boolean;
  nudgedAt: number | null; // when a pre-meeting nudge was generated (idempotency)
  createdAt: number;
}

export interface NewMeeting {
  clientId: string;
  datetime: string | null;
  datetimeRaw: string;
  title: string | null;
  confirmed: boolean;
}

export interface MeetingRepository {
  create(userId: string, meeting: NewMeeting): Promise<MeetingRecord>;
  listByUser(userId: string): Promise<MeetingRecord[]>;
  findByIdForUser(userId: string, id: string): Promise<MeetingRecord | null>;
  delete(userId: string, id: string): Promise<boolean>;
  /** Meetings with a resolved datetime in [fromIso, toIso] that haven't been nudged. */
  dueForNudge(userId: string, fromIso: string, toIso: string): Promise<MeetingRecord[]>;
  markNudged(userId: string, id: string, at: number): Promise<void>;
}
