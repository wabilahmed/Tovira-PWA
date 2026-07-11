/**
 * Port: scheduled/background jobs (the daily going-cold / upcoming-meeting scan).
 * Local dev uses an in-process scheduler; prod uses EventBridge + Lambda.
 */

export interface ScheduledJob {
  name: string;
  run: () => Promise<void>;
}

export interface Scheduler {
  register(job: ScheduledJob): void;
  list(): string[];
  /** Run a registered job now (used by local dev and tests). */
  trigger(name: string): Promise<void>;
}
