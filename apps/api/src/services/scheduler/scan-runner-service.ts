import type { PushableAlert } from '../push/push-dispatch-service.js';

export interface ScanRunnerDeps {
  /** Every rep to scan this tick (same seam as the notes sweep + meeting nudges). */
  allUserIds: () => Promise<string[]>;
  /** Run all scan generators for one rep, returning the alerts eligible for push. */
  runAll: (userId: string, nowMs: number) => Promise<{ pushables: PushableAlert[] }>;
  /** Deliver a rep's alerts through the silence budget (records all in-app, pushes the loudest ≤2). */
  dispatch: (userId: string, alerts: PushableAlert[], nowMs: number) => Promise<void>;
  now?: () => number;
}

/**
 * [SCAN-WIRING] The daily proactive scan, run on the in-process ScheduledBrain — the automated
 * trigger the stub EventBridge Lambda never provided. Without this, overdue-promise / going-cold /
 * date-reminder / chat-refresh alerts only ever fired when a rep tapped "Rescan" by hand (the 6th
 * instance of the built-but-unwired pattern). Every generator is idempotent (deduped), so running
 * it a few times a day never double-sends; the 2/day silence budget bounds the push volume.
 */
export class ScanRunnerService {
  constructor(private readonly deps: ScanRunnerDeps) {}

  async run(nowMs: number = (this.deps.now ?? Date.now)()): Promise<number> {
    let dispatched = 0;
    for (const userId of await this.deps.allUserIds()) {
      const summary = await this.deps.runAll(userId, nowMs);
      if (summary.pushables.length > 0) {
        await this.deps.dispatch(userId, summary.pushables, nowMs);
        dispatched += summary.pushables.length;
      }
    }
    return dispatched;
  }
}
