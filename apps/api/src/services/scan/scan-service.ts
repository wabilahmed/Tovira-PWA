import type { ClientRepository } from '../../ports/client-repository.js';
import type { MeetingRepository, MeetingRecord } from '../../ports/meeting-repository.js';
import type { FactsRepository, KeyDateRecord } from '../../ports/facts-repository.js';
import type { NotificationRepository } from '../../ports/notification-repository.js';
import type { NoteRepository } from '../../ports/note-repository.js';
import type { PushableAlert } from '../push/push-dispatch-service.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const RECURRING_TYPES = new Set(['birthday', 'anniversary']);

export interface ScanConfig {
  coldThresholdDays: number;
  nudgeLeadMs: number;
  reminderWindowDays: number;
  chatRefreshStaleDays: number;
}

export interface ScanSummary {
  overduePromises: number;
  nudges: number;
  goingCold: number;
  dateReminders: number;
  chatRefresh: number;
  /** The alerts created this run that are eligible for a push — the silence
   *  budget picks the loudest few of these to actually send. */
  pushables: PushableAlert[];
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
    private readonly notes: NoteRepository,
  ) {}

  /**
   * Overdue promises (the LOUDEST alert): a commitment the rep owns, not yet
   * done, whose resolved due date is strictly before today. Fires once per
   * promise (deduped by id); unresolved/no-date promises never fire.
   */
  async overduePromises(userId: string, nowMs: number, sink?: PushableAlert[]): Promise<number> {
    const todayIso = new Date(nowMs).toISOString().slice(0, 10);
    const promises = await this.facts.listPromisesByUser(userId);
    let created = 0;
    for (const p of promises) {
      if (p.owner !== 'rep' || p.done || !p.dueDate) continue;
      if (p.dueDate >= todayIso) continue; // due today or later → not overdue
      const entry = {
        type: 'overdue_promise' as const,
        dedupeKey: `promise:${p.id}`,
        clientId: p.clientId,
        title: 'Overdue promise',
        body: `Overdue — ${p.text}`,
      };
      const ok = await this.notifications.createIfAbsent(userId, entry);
      if (ok) { created += 1; sink?.push(entry); }
    }
    return created;
  }

  async nudges(
    userId: string,
    nowMs: number,
    leadMs: number,
    sink?: PushableAlert[],
    /** NUDGE-CONTENT: optional richer content (client + time + top actionable item + deep link).
     *  When absent (e.g. the daily scan), fall back to the bare meeting line. */
    compose?: (m: MeetingRecord) => Promise<{ clientId: string; title: string; body: string; url?: string }>,
  ): Promise<number> {
    const from = new Date(nowMs).toISOString();
    const to = new Date(nowMs + leadMs).toISOString();
    const due = await this.meetings.dueForNudge(userId, from, to);
    let created = 0;
    for (const m of due) {
      const content = compose
        ? await compose(m)
        : { clientId: m.clientId, title: 'Upcoming meeting', body: `Meeting soon — ${m.datetimeRaw}` };
      const entry: PushableAlert = {
        type: 'pre_meeting_nudge',
        dedupeKey: `nudge:${m.id}`,
        clientId: content.clientId,
        title: content.title,
        body: content.body,
        ...('url' in content && content.url ? { url: content.url } : {}),
      };
      const ok = await this.notifications.createIfAbsent(userId, entry);
      await this.meetings.markNudged(userId, m.id, nowMs);
      if (ok) { created += 1; sink?.push(entry); }
    }
    return created;
  }

  async goingCold(userId: string, nowMs: number, thresholdDays: number, sink?: PushableAlert[]): Promise<number> {
    const cold = await this.clients.listGoingCold(userId, nowMs - thresholdDays * DAY_MS);
    let created = 0;
    for (const c of cold) {
      const entry = {
        type: 'going_cold' as const,
        dedupeKey: `cold:${c.id}`,
        clientId: c.id,
        title: 'Client going cold',
        body: `${c.name} hasn’t been touched in a while.`,
      };
      const ok = await this.notifications.createIfAbsent(userId, entry);
      if (ok) { created += 1; sink?.push(entry); }
    }
    return created;
  }

  async dateReminders(userId: string, nowMs: number, windowDays: number, sink?: PushableAlert[]): Promise<number> {
    const dates = await this.facts.listKeyDatesByUser(userId);
    let created = 0;
    for (const d of dates) {
      const due = nextReminderDate(d, nowMs, windowDays);
      if (!due) continue;
      const entry = {
        type: 'date_reminder' as const,
        dedupeKey: `date:${d.id}:${due}`,
        clientId: d.clientId,
        title: 'Upcoming date',
        body: `${d.description} — ${due}`,
      };
      const ok = await this.notifications.createIfAbsent(userId, entry);
      if (ok) { created += 1; sink?.push(entry); }
    }
    return created;
  }

  /**
   * Chat-refresh nudges (P3-7): when a client's last WhatsApp import has gone
   * stale, suggest the 3-tap re-export. Idempotent and non-nagging — the dedupe
   * key is tied to the specific stale import, so it fires once; a re-import
   * (a new note) only re-nudges after that in turn goes stale.
   */
  async chatRefreshNudges(userId: string, nowMs: number, staleDays: number, sink?: PushableAlert[]): Promise<number> {
    const cutoff = nowMs - staleDays * DAY_MS;
    const clients = await this.clients.listByUser(userId);
    let created = 0;
    for (const c of clients) {
      const imports = (await this.notes.listByClient(userId, c.id)).filter((n) => n.source === 'whatsapp_export');
      if (imports.length === 0) continue; // never imported → onboarding's job, not refresh
      const latest = imports.reduce((a, b) => (b.createdAt > a.createdAt ? b : a));
      if (latest.createdAt >= cutoff) continue; // recently refreshed → no nudge
      const entry = {
        type: 'chat_refresh' as const,
        dedupeKey: `refresh:${c.id}:${latest.id}`,
        clientId: c.id,
        title: 'Refresh this chat',
        body: `It's been a while — re-export ${c.name}'s WhatsApp chat (3 taps) to keep Tovira current.`,
      };
      const ok = await this.notifications.createIfAbsent(userId, entry);
      if (ok) { created += 1; sink?.push(entry); }
    }
    return created;
  }

  async runAll(userId: string, nowMs: number, cfg: ScanConfig): Promise<ScanSummary> {
    const pushables: PushableAlert[] = [];
    return {
      overduePromises: await this.overduePromises(userId, nowMs, pushables),
      nudges: await this.nudges(userId, nowMs, cfg.nudgeLeadMs, pushables),
      goingCold: await this.goingCold(userId, nowMs, cfg.coldThresholdDays, pushables),
      dateReminders: await this.dateReminders(userId, nowMs, cfg.reminderWindowDays, pushables),
      chatRefresh: await this.chatRefreshNudges(userId, nowMs, cfg.chatRefreshStaleDays, pushables),
      pushables,
    };
  }
}
