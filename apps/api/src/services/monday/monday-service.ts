import type { ClientRepository } from '../../ports/client-repository.js';
import type { NoteRepository } from '../../ports/note-repository.js';
import type { FactsRepository } from '../../ports/facts-repository.js';
import type { NotificationRepository } from '../../ports/notification-repository.js';
import type { PushDispatchService } from '../push/push-dispatch-service.js';
import type { UnansweredQuestion } from '../import/unanswered.js';

/**
 * Monday Morning Scan (P3-8): a weekly digest that sets up the rep's week —
 * promises due this week, cooling clients, unanswered client questions, upcoming
 * dates. Viewable in-app regardless of push. A light week is stated honestly
 * ("clear week"), never padded with stale or fabricated items.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export interface MondayDigest {
  weekOf: string;
  promisesDue: Array<{ id: string; text: string; dueDate: string | null; clientId: string }>;
  coolingClients: Array<{ id: string; name: string; lastTouchedAt: number }>;
  unansweredQuestions: Array<{ clientId: string; question: string; date: string | null }>;
  upcomingDates: Array<{ clientId: string; description: string; date: string }>;
  isLight: boolean;
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function mondayOf(nowMs: number): string {
  const d = new Date(nowMs);
  const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const offset = (new Date(start).getUTCDay() + 6) % 7; // days since Monday
  return isoDate(start - offset * DAY_MS);
}

export class MondayDigestService {
  constructor(
    private readonly clients: ClientRepository,
    private readonly notes: NoteRepository,
    private readonly facts: FactsRepository,
    private readonly notifications: NotificationRepository,
    private readonly coldThresholdDays: number,
    private readonly pushDispatch: PushDispatchService,
  ) {}

  async build(userId: string, nowMs: number): Promise<MondayDigest> {
    const today = isoDate(nowMs);
    const weekEnd = isoDate(nowMs + 7 * DAY_MS);

    const promisesDue = (await this.facts.listPromisesByUser(userId))
      .filter((p) => !p.done && p.dueDate && p.dueDate >= today && p.dueDate <= weekEnd)
      .map((p) => ({ id: p.id, text: p.text, dueDate: p.dueDate, clientId: p.clientId }));

    const coolingClients = (await this.clients.listGoingCold(userId, nowMs - this.coldThresholdDays * DAY_MS)).map((c) => ({ id: c.id, name: c.name, lastTouchedAt: c.lastTouchedAt }));

    const upcomingDates = (await this.facts.listKeyDatesByUser(userId))
      .filter((d) => d.date && d.date >= today && d.date <= weekEnd)
      .map((d) => ({ clientId: d.clientId, description: d.description, date: d.date! }));

    const clients = await this.clients.listByUser(userId);
    const unansweredQuestions: MondayDigest['unansweredQuestions'] = [];
    for (const c of clients) {
      for (const n of await this.notes.listByClient(userId, c.id)) {
        const ex = n.extracted as { unanswered_questions?: UnansweredQuestion[] } | null;
        for (const q of ex?.unanswered_questions ?? []) {
          if (q.question.trim()) unansweredQuestions.push({ clientId: c.id, question: q.question.trim(), date: q.sentAt });
        }
      }
    }

    const isLight = promisesDue.length === 0 && coolingClients.length === 0 && upcomingDates.length === 0 && unansweredQuestions.length === 0;
    return { weekOf: mondayOf(nowMs), promisesDue, coolingClients, unansweredQuestions, upcomingDates, isLight };
  }

  /** Emit the weekly digest notification once per week (idempotent). */
  async notifyMonday(userId: string, nowMs: number): Promise<boolean> {
    const digest = await this.build(userId, nowMs);
    const body = digest.isLight
      ? 'A clear week — nothing due, no one cooling. Nice.'
      : `${digest.promisesDue.length} promise(s) due, ${digest.coolingClients.length} cooling, ${digest.unansweredQuestions.length} open question(s).`;
    const alert = {
      type: 'monday_digest' as const,
      dedupeKey: `monday:${digest.weekOf}`,
      clientId: null,
      title: 'Your Monday scan',
      body,
    };
    // Record + gate on "new this week" (idempotent), then route the PUSH through
    // the silence budget — the Monday digest is ranked lowest and counts against
    // the 2/day cap like everything else (brand §10, no exceptions). Suppressed
    // from push is never lost: the in-app record above already stands.
    const isNew = await this.notifications.createIfAbsent(userId, alert);
    if (isNew) await this.pushDispatch.dispatch(userId, [alert], nowMs);
    return isNew;
  }
}
