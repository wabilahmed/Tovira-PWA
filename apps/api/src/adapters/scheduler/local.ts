import type { Scheduler, ScheduledJob } from '../../ports/scheduler.js';

/**
 * Local stand-in for EventBridge + Lambda: holds registered jobs in-process and
 * runs them on demand. A dev cron/script drives `trigger`; prod swaps in the
 * managed scheduler behind the same interface.
 */
export class LocalScheduler implements Scheduler {
  private readonly jobs = new Map<string, ScheduledJob>();

  register(job: ScheduledJob): void {
    this.jobs.set(job.name, job);
  }

  list(): string[] {
    return [...this.jobs.keys()];
  }

  async trigger(name: string): Promise<void> {
    const job = this.jobs.get(name);
    if (!job) throw new Error(`no such scheduled job: ${name}`);
    await job.run();
  }
}
