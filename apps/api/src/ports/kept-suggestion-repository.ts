/**
 * Port: [P24-2] "Looks like you sent it — mark done?" suggestions. A delivery the promise's owner states
 * later in a chat never closes the promise; it becomes one of these, answered by the rep (Mark done / Not
 * yet). Identity is (client, promise key, delivery message time) — the promise KEY (owner + normalised text,
 * the facts dedupe identity), not its row id, because re-extracting a note recreates its promise rows: a
 * "Not yet" on a delivery message must hold across re-imports, while a NEW delivery message can suggest again.
 * Tenant-scoped; the Postgres impl is RLS-bound (migration 0090).
 */
export type KeptSuggestionStatus = 'open' | 'dismissed' | 'accepted';

export interface KeptSuggestionRecord {
  id: string;
  userId: string;
  clientId: string;
  noteId: string;
  promiseKey: string;
  promiseOwner: 'rep' | 'client';
  promiseText: string;
  /** The promise receipt: its verbatim span + message time (wall-clock "YYYY-MM-DDTHH:MM[:SS]"). */
  promiseSpan: string | null;
  promiseAt: string | null;
  /** The delivery receipt: the message that says it was delivered. */
  deliveryAt: string;
  deliveryBody: string;
  status: KeptSuggestionStatus;
  createdAt: number;
  resolvedAt: number | null;
}

export type NewKeptSuggestion = Omit<KeptSuggestionRecord, 'id' | 'userId' | 'status' | 'createdAt' | 'resolvedAt'>;

export interface KeptSuggestionRepository {
  /** Create an OPEN suggestion unless one already exists for (client, key, deliveryAt) in ANY status. */
  createIfAbsent(userId: string, s: NewKeptSuggestion): Promise<boolean>;
  /** Delivery message times already suggested (any status) for this promise — skipped by detection. */
  deliveryTimes(userId: string, clientId: string, promiseKey: string): Promise<Set<string>>;
  listOpen(userId: string): Promise<KeptSuggestionRecord[]>;
  get(userId: string, id: string): Promise<KeptSuggestionRecord | null>;
  setStatus(userId: string, id: string, status: KeptSuggestionStatus, nowMs: number): Promise<boolean>;
}
