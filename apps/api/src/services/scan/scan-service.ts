import type { ClientRepository } from '../../ports/client-repository.js';
import type { MeetingRepository } from '../../ports/meeting-repository.js';
import type { FactsRepository, KeyDateRecord } from '../../ports/facts-repository.js';
import type { NotificationRepository } from '../../ports/notification-repository.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const RECURRING_TYPES = new Set(['birthday', 'anniversary']);

export interface ScanConfig {
  coldThresholdDays: number;
  nudgeLeadMs: number;
  reminderWindowDays: number;
}

export interface ScanSummary {
  nudges: number;
  goingCold: number;
  dateReminders: number;
}

function startOfDayUtc(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * The next date a key-date should remind, or null. Unresolved dates never fire
 * (no misfire). Recurring types (birthday/anniversary) roll to this/next year;
 * one-off types in the past don't re-fire. Only returns a date inside the window.
 */
export function nextReminderDate(d: KeyDateRecord, nowMs: number, windowDays: number): string | null {
  if (!d.date) return null;
  const [y, mo, da] = d.date.split('-').map(Number) as [number, number, number];
  const todayUtc = startOfDayUtc(nowMs);
  const windowEnd = todayUtc + windowDays * DAY_MS;

  let occ: number;
  if (RECURRING_TYPES.has(d.type)) {
    const thisYear = Date.UTC(new Date(nowMs).getUTCFullYear(), mo - 1, da);
    occ = thisYear >= todayUtc ? thisYear : Date.UTC(new Date(nowMs).getUTCFullYear() + 1, mo - 1, da);
  } else {
    occ = Date.UTC(y, mo - 1, da);
    if (occ < todayUtc) return null; // past one-off → don't re-fire
  }
  if (occ >= todayUtc && occ <= windowEnd) return new Date(occ).toISOString().slice(0, 10);
  return null;
}

/**
 * The daily "scheduled brain" (P3-2/3/4): generate pre-meeting nudges,
 * going-cold alerts, and date reminders as notifications. Every generator is
 * idempotent (deduped) so re-running the scan never double-sends.
 */
export class ScanService {
  constructor(
    private readonly clients: ClientRepository,
    private readonly meetings: MeetingRepository,
    private readonly facts: FactsRepository,
    private readonly notifications: NotificationRepository,
  ) {}

  async nudges(userId: string, nowMs: number, leadMs: number): Promise<number> {
    const from = new Date(nowMs).toISOString();
    const to = new Date(nowMs + leadMs).toISOString();
    const due = await this.meetings.dueForNudge(userId, from, to);
    let created = 0;
    for (const m of due) {
      const ok = await this.notifications.createIfAbsent(userId, {
        type: 'pre_meeting_nudge',
        dedupeKey: `nudge:${m.id}`,
        clientId: m.clientId,
        title: 'Upcoming meeting',
        body: `Meeting soon — ${m.datetimeRaw}`,
      });
      await this.meetings.markNudged(userId, m.id, nowMs);
      if (ok) created += 1;
    }
    return created;
  }

  async goingCold(userId: string, nowMs: number, thresholdDays: number): Promise<number> {
    const cold = await this.clients.listGoingCold(userId, nowMs - thresholdDays * DAY_MS);
    let created = 0;
    for (const c of cold) {
      const ok = await this.notifications.createIfAbsent(userId, {
        type: 'going_cold',
        dedupeKey: `cold:${c.id}`,
        clientId: c.id,
        title: 'Client going cold',
        body: `${c.name} hasn’t been touched in a while.`,
      });
      if (ok) created += 1;
    }
    return created;
  }

  async dateReminders(userId: string, nowMs: number, windowDays: number): Promise<number> {
    const dates = await this.facts.listKeyDatesByUser(userId);
    let created = 0;
    for (const d of dates) {
      const due = nextReminderDate(d, nowMs, windowDays);
      if (!due) continue;
      const ok = await this.notifications.createIfAbsent(userId, {
        type: 'date_reminder',
        dedupeKey: `date:${d.id}:${due}`,
        clientId: d.clientId,
        title: 'Upcoming date',
        body: `${d.description} — ${due}`,
      });
      if (ok) created += 1;
    }
    return created;
  }

  async runAll(userId: string, nowMs: number, cfg: ScanConfig): Promise<ScanSummary> {
    return {
      nudges: await this.nudges(userId, nowMs, cfg.nudgeLeadMs),
      goingCold: await this.goingCold(userId, nowMs, cfg.coldThresholdDays),
      dateReminders: await this.dateReminders(userId, nowMs, cfg.reminderWindowDays),
    };
  }
}
