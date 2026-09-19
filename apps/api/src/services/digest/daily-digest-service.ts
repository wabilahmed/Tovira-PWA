import type { PrioritiesRepository } from '../../ports/priorities-repository.js';
import type { NotificationRepository } from '../../ports/notification-repository.js';
import type { PushableAlert } from '../push/push-dispatch-service.js';
import type { TodayAction } from '../hero/hero-service.js';
import { zonedTodayIso, zonedWeekdayHour } from '../time/zone.js';

/**
 * [NOTIF-REWORK Task 3] The daily digest — the ONE discretionary push. Once per rep per day it
 * announces "N things need you" and opens the daily list. It exists so the discretionary findings
 * (going-cold, overdue promises, matches, …) get presence without a per-finding flood — the flood
 * that pushes a rep to silence notifications at the OS level, which would also kill meeting nudges.
 *
 * It READS the precomputed daily-priorities cache and never recomputes: the priorities are ranked
 * once nightly (a model call) and app-opens serve the cache; the digest must not become a second
 * expensive path, so it only calls priorities.get.
 *
 * Time-critical items push individually and are NOT the digest's job, so the count excludes the
 * `meeting` kind (pre-meeting nudges already fired). Everything else in the list is a discretionary
 * finding. (A promise due today also pushes individually AND is one of the day's list items — it is
 * counted here as a legitimate "thing needing you today"; the small overlap is intended.)
 *
 * No findings → NO push. An empty digest is worse than silence.
 */

/** TodayAction kinds counted as discretionary findings for the digest. `meeting` is time-critical
 *  (pushed as a pre-meeting nudge), so it is excluded. */
const DISCRETIONARY_KINDS: ReadonlySet<TodayAction['kind']> = new Set(['promise', 'cold', 'risk', 'match']);

/** Default digest hour, rep-local. DERIVATION: start of the workday, so the rep opens the day's
 *  list before client work — and after the nightly priorities precompute (which runs past the rep's
 *  local midnight), so the cache is warm. NOT SETTLED: a judgement call; revisit with pilot feedback. */
export const DEFAULT_DIGEST_HOUR = 8;

export interface DailyDigestDeps {
  priorities: PrioritiesRepository;
  notifications: NotificationRepository;
  /** Push through the shared dispatcher (daily_digest is time-critical → it pushes). */
  dispatch: (userId: string, alerts: PushableAlert[]) => Promise<unknown>;
  /** [TZ-BOUNDARY] the digest fires on the rep's local clock. */
  timezoneFor?: (userId: string) => Promise<string>;
}

export class DailyDigestService {
  constructor(private readonly deps: DailyDigestDeps) {}

  private discretionaryCount(actions: TodayAction[]): number {
    return actions.filter((a) => DISCRETIONARY_KINDS.has(a.kind)).length;
  }

  /**
   * Fire the digest for every rep whose local digest hour has arrived. Idempotent per rep-day
   * (dedupeKey `digest:<localDay>` gated by createIfAbsent). Returns how many digests were pushed.
   */
  async runScheduled(userIds: string[], nowMs: number, opts: { digestHour?: number } = {}): Promise<number> {
    const digestHour = opts.digestHour ?? DEFAULT_DIGEST_HOUR;
    let sent = 0;
    for (const userId of userIds) {
      const tz = this.deps.timezoneFor ? await this.deps.timezoneFor(userId) : 'Etc/UTC';
      const { hour } = zonedWeekdayHour(tz, new Date(nowMs));
      if (hour < digestHour) continue; // wait for the rep's local digest hour

      const day = zonedTodayIso(tz, new Date(nowMs));
      const cached = await this.deps.priorities.get(userId, day); // READ the precomputed cache — never recompute
      if (!cached) continue; // no precomputed list yet → nothing to announce
      const count = this.discretionaryCount(cached.actions);
      if (count === 0) continue; // no findings → NO push (empty digest is worse than silence)

      const alert: PushableAlert = {
        type: 'daily_digest',
        dedupeKey: `digest:${day}`,
        clientId: null,
        title: 'Your day',
        body: `${count} ${count === 1 ? 'thing needs' : 'things need'} you`,
        url: '/today', // opens the daily list
      };
      // Gate the push on first-of-day (idempotent): createIfAbsent is false on a re-run, so the
      // hourly cron never re-pushes the same day's digest.
      const isNew = await this.deps.notifications.createIfAbsent(userId, {
        type: alert.type, dedupeKey: alert.dedupeKey, clientId: alert.clientId, title: alert.title, body: alert.body,
      });
      if (!isNew) continue;
      await this.deps.dispatch(userId, [alert]);
      sent += 1;
    }
    return sent;
  }
}
