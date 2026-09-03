import type { PushableAlert } from '../push/push-dispatch-service.js';
import type { MeetingRecord } from '../../ports/meeting-repository.js';
import { composeNudgeContent } from './nudge-content.js';
import type { NudgeSignals } from './nudge-content.js';

type Compose = (m: MeetingRecord) => Promise<{ clientId: string; title: string; body: string; url?: string }>;

export interface MeetingNudgeDeps {
  /** Every rep to consider this tick (same seam as the notes sweep). */
  allUserIds: () => Promise<string[]>;
  /**
   * Generate + mark the due nudges for one rep into `sink`; returns the count.
   * Delegates to ScanService.nudges so there is ONE nudge generator: it selects
   * confirmed, un-nudged meetings whose start is in [now, now+windowMs] and calls
   * markNudged on each (idempotency lives on the meeting row, not in memory). The
   * optional `compose` fills the nudge with the client + time + top actionable item.
   */
  generate: (userId: string, nowMs: number, windowMs: number, sink: PushableAlert[], compose?: Compose) => Promise<number>;
  /** NUDGE-CONTENT: gather the client's signals for a meeting; when absent, nudges are bare. */
  signalsFor?: (userId: string, meeting: MeetingRecord, nowMs: number) => Promise<NudgeSignals>;
  /** Deliver a rep's nudges through the silence budget (ranked, capped) + in-app record. */
  dispatch: (userId: string, alerts: PushableAlert[], nowMs: number) => Promise<void>;
  /**
   * The nudge window = lead + tolerance (A2 decision: 2h ± 15m, configurable). A meeting fires
   * when its start is within this of `now` AND still in the future:
   *  - a meeting far out fires when it first enters the window (~2h ahead; the +15m tolerance
   *    absorbs a missed tick / restart without silently skipping — the row stays due until nudged);
   *  - a meeting created LESS than 2h before it starts is already inside the window, so it nudges
   *    on the next tick ("immediately"), once;
   *  - a meeting whose start is already in the past is excluded by the generator's `datetime >= now`
   *    filter, so retroactively-logged meetings never nudge.
   */
  windowMs: number;
  now?: () => number;
}

/**
 * [NUDGE-SCHED] The meeting-nudge job. Runs on the in-process scheduled brain every ~minute
 * (its own advisory lock), not on the daily scan — a daily job cannot produce a 2-hour-ahead
 * nudge. Idempotent per meeting across restarts, overlapping runs and clock skew: the "nudged"
 * marker is persisted on the meeting row (nudged_at), so a re-run finds nothing to re-send.
 */
export class MeetingNudgeService {
  constructor(private readonly deps: MeetingNudgeDeps) {}

  async run(nowMs: number = (this.deps.now ?? Date.now)()): Promise<number> {
    let sent = 0;
    for (const userId of await this.deps.allUserIds()) {
      const sink: PushableAlert[] = [];
      const signalsFor = this.deps.signalsFor;
      const compose: Compose | undefined = signalsFor
        ? async (m) => composeNudgeContent(await signalsFor(userId, m, nowMs))
        : undefined;
      await this.deps.generate(userId, nowMs, this.deps.windowMs, sink, compose);
      if (sink.length > 0) {
        await this.deps.dispatch(userId, sink, nowMs);
        sent += sink.length;
      }
    }
    return sent;
  }
}
