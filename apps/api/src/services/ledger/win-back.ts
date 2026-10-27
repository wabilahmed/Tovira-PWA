import type { GoingQuietAlertRepository } from '../../ports/going-quiet-alert-repository.js';
import type { ClientRepository } from '../../ports/client-repository.js';
import type { NoteRepository } from '../../ports/note-repository.js';
import { NO_RESTRICTION, type Restriction } from '../erasure/restriction.js';
import { zonedWallClockToInstant } from '../time/zone.js';

/** [P47-2] The client's first message must come within this many days after the alert reached the rep. */
export const WIN_BACK_WINDOW_DAYS = 7;
const DAY_MS = 86_400_000;

/** One "Clients Tovira helped you win back" card. No AED: it is not a deal. */
export interface WinBackEntry {
  id: string;
  clientId: string;
  clientName: string;
  /** When the going-quiet alert reached the rep. */
  flaggedAt: number;
  silentDays: number;
  /** When the client sent their first message after it. */
  wroteBackAt: number;
  receipt: { quote: string; at: string; noteId: string };
}

/**
 * [P47-2] "Re-engaged after an alert": the client's FIRST own message (role 'client', not held back) sent within
 * WIN_BACK_WINDOW_DAYS after a going-quiet alert reached the rep. The message is dated by when the client sent it (the
 * chat's own timestamp, read in the rep's time zone), never by when the chat was imported, and must come after the
 * alert. Both recorded events are required; nothing is inferred. One entry per alert.
 */
export class WinBackService {
  constructor(private readonly deps: {
    alerts: GoingQuietAlertRepository;
    clients: Pick<ClientRepository, 'findByIdForUser'>;
    notes: Pick<NoteRepository, 'listByClient'>;
    /** [TASK 2] The erasure-restricted notes view (the restricted person's messages are gone); defaults to `notes`. */
    notesView?: Pick<NoteRepository, 'listByClient'>;
    timezoneFor: (userId: string) => Promise<string>;
    /** The same rule as Today's going-quiet card: silent more than this many days. */
    coldThresholdDays: number;
    restriction?: { forUser(userId: string): Promise<Restriction> };
  }) {}

  /**
   * The app showed Today's going-quiet cards for these clients: record that the alert reached the rep. The server checks
   * each client really is going quiet now (the app's word alone records nothing); one row per silence.
   */
  async recordShown(userId: string, clientIds: string[], nowMs: number): Promise<number> {
    let n = 0;
    for (const id of [...new Set(clientIds)].slice(0, 50)) {
      const c = await this.deps.clients.findByIdForUser(userId, id);
      if (!c) continue;
      const silentDays = (nowMs - c.lastTouchedAt) / DAY_MS;
      if (silentDays <= this.deps.coldThresholdDays) continue;
      await this.deps.alerts.recordReached(userId, { clientId: c.id, quietSince: c.lastTouchedAt, silentDays: Math.round(silentDays), reachedAt: nowMs, reachedVia: 'today' });
      n += 1;
    }
    return n;
  }

  async entries(userId: string): Promise<WinBackEntry[]> {
    const alerts = await this.deps.alerts.listByUser(userId);
    if (alerts.length === 0) return [];
    const tz = await this.deps.timezoneFor(userId);
    const r = this.deps.restriction ? await this.deps.restriction.forUser(userId) : NO_RESTRICTION;
    const out: WinBackEntry[] = [];
    for (const a of alerts) {
      const client = await this.deps.clients.findByIdForUser(userId, a.clientId);
      if (!client) continue;
      if (r.active && r.restrictsWho(client.name)) continue; // [TASK 2] erasure restriction
      let first: { at: number; body: string; sentAt: string; noteId: string } | null = null;
      for (const n of await (this.deps.notesView ?? this.deps.notes).listByClient(userId, a.clientId)) {
        for (const m of n.messages ?? []) {
          if (m.role !== 'client' || m.excluded || !m.sentAt) continue;
          let at: number;
          try { at = zonedWallClockToInstant(m.sentAt, tz).getTime(); } catch { continue; }
          if (at <= a.reachedAt) continue; // before (or at) the alert: not a reply to it
          if (!first || at < first.at) first = { at, body: m.body, sentAt: m.sentAt, noteId: n.id };
        }
      }
      if (!first || first.at - a.reachedAt > WIN_BACK_WINDOW_DAYS * DAY_MS) continue; // the FIRST reply must be in the window
      out.push({ id: a.id, clientId: client.id, clientName: client.name, flaggedAt: a.reachedAt, silentDays: a.silentDays, wroteBackAt: first.at, receipt: { quote: first.body, at: first.sentAt, noteId: first.noteId } });
    }
    return out.sort((x, y) => y.wroteBackAt - x.wroteBackAt);
  }
}
