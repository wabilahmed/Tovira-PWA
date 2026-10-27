/**
 * Port: [P47-2] going-quiet alerts that REACHED the rep (the Today card shown, or a delivered push). Tenant-scoped (RLS
 * on pg). One per silence (client + quiet_since); recording the same silence again keeps the first time it reached.
 */
export interface GoingQuietAlert {
  id: string;
  clientId: string;
  /** The client's last activity when the alert reached the rep: the start of this silence. */
  quietSince: number;
  silentDays: number;
  reachedAt: number;
  reachedVia: 'today' | 'push';
}

export interface GoingQuietAlertRepository {
  recordReached(userId: string, a: Omit<GoingQuietAlert, 'id'>): Promise<void>;
  listByUser(userId: string): Promise<GoingQuietAlert[]>;
}
