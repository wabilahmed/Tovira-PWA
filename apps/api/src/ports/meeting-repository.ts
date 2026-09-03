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
  /** Source note when the meeting was proposed by extraction; null for rep-created. */
  noteId: string | null;
  nudgedAt: number | null; // when a pre-meeting nudge was generated (idempotency)
  createdAt: number;
}

export interface NewMeeting {
  clientId: string;
  datetime: string | null;
  datetimeRaw: string;
  title: string | null;
  confirmed: boolean;
  /** Provenance: the note this was extracted from (NUDGE-UNCONFIRMED), or null. */
  noteId?: string | null;
}

export interface MeetingRepository {
  create(userId: string, meeting: NewMeeting): Promise<MeetingRecord>;
  listByUser(userId: string): Promise<MeetingRecord[]>;
  findByIdForUser(userId: string, id: string): Promise<MeetingRecord | null>;
  /** The proposed meeting already persisted for a note (idempotent extraction), or null. */
  findByNoteId(userId: string, noteId: string): Promise<MeetingRecord | null>;
  /** Unconfirmed meetings — surfaced as "unconfirmed — is this right?" and in the queue. */
  listUnconfirmedByUser(userId: string): Promise<MeetingRecord[]>;
  /** Confirm a proposed meeting → confirmed = true, making it nudge-eligible. Returns the row, or null. */
  confirm(userId: string, id: string): Promise<MeetingRecord | null>;
  delete(userId: string, id: string): Promise<boolean>;
  /** Meetings with a resolved datetime in [fromIso, toIso] that haven't been nudged. */
  dueForNudge(userId: string, fromIso: string, toIso: string): Promise<MeetingRecord[]>;
  markNudged(userId: string, id: string, at: number): Promise<void>;
}
