import type { FactsRepository } from '../../ports/facts-repository.js';
import type { MeetingRepository } from '../../ports/meeting-repository.js';
import type { ClientRepository } from '../../ports/client-repository.js';
import type { Receipt } from './recall-service.js';

/**
 * [P18-5] Structured cross-client retrieval for Ask.
 *
 * Vector note-search answers "what did Ahmed say about pricing?" — a single semantic match. It CANNOT
 * answer an aggregate question that spans the whole book ("what have I promised and to whom?", "who do
 * I have meetings with this month?", "what deadlines are coming up?"): those answers live in the
 * extracted FACT tables (promises, meetings, key dates) keyed by date and client, not in any one note's
 * prose, and top-k over notes structurally caps at a handful of clients.
 *
 * This source returns a BOUNDED digest of the rep's structured facts across ALL clients — each as a
 * grounded Receipt (a verbatim-style line that NAMES its client, with the fact's own date, pointing at
 * its source note). The recall service merges these with the vector matches before the token-budget cap,
 * so vector receipts still win the budget for specific questions and the structured digest fills the
 * rest for aggregate ones. Every line is a real stored fact — nothing is invented.
 */
export interface StructuredRecallDeps {
  facts: Pick<FactsRepository, 'listPromisesByUser' | 'listKeyDatesByUser'>;
  meetings: Pick<MeetingRepository, 'listByUser'>;
  clients: Pick<ClientRepository, 'listByUser'>;
}

export interface StructuredRecallConfig {
  /** Per-kind cap (promises / meetings / key dates). Keeps the digest small + cheap. Default 8. */
  maxPerKind: number;
  /** Only surface meetings/key dates from (today − graceDays) through (today + windowDays). Default 180. */
  windowDays: number;
  /** How far back a just-passed date still counts as "upcoming-ish" context. Default 3. */
  graceDays: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_CONFIG: StructuredRecallConfig = { maxPerKind: 8, windowDays: 180, graceDays: 3 };

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Leading YYYY-MM-DD of an ISO string, read positionally (timezone can't drift the day). */
function dayOf(iso: string | null): string | null {
  if (!iso) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(iso.trim());
  return m ? m[1]! : null;
}

export class StructuredRecall {
  constructor(
    private readonly deps: StructuredRecallDeps,
    private readonly config: StructuredRecallConfig = DEFAULT_CONFIG,
  ) {}

  /** A bounded set of grounded receipts drawn from the rep's structured facts across every client. */
  async forUser(userId: string, nowMs: number = Date.now()): Promise<Receipt[]> {
    const [clients, promises, keyDates, meetings] = await Promise.all([
      this.deps.clients.listByUser(userId),
      this.deps.facts.listPromisesByUser(userId),
      this.deps.facts.listKeyDatesByUser(userId),
      this.deps.meetings.listByUser(userId),
    ]);
    const nameOf = new Map(clients.map((c) => [c.id, c.name]));
    const today = isoDate(nowMs);
    const horizon = isoDate(nowMs + this.config.windowDays * DAY_MS);
    const floor = isoDate(nowMs - this.config.graceDays * DAY_MS);
    const out: Receipt[] = [];

    // Open promises across all clients — the soonest (and overdue) first; a promise with no date comes
    // after the dated ones. listPromisesByUser already returns canonicals only (no merged duplicates).
    const open = promises
      .filter((p) => !p.done)
      .sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'))
      .slice(0, this.config.maxPerKind);
    for (const p of open) {
      out.push({
        quote: `${nameOf.get(p.clientId) ?? 'A client'} — you promised to ${p.text}`,
        date: p.dueDate ?? dayOf(p.sourceMessageAt) ?? p.captureAt ?? isoDate(p.createdAt),
        clientId: p.clientId,
        noteId: p.noteId,
      });
    }

    // Upcoming meetings within the window, soonest first.
    const upcomingMeetings = meetings
      .filter((m) => { const d = dayOf(m.datetime); return d !== null && d >= floor && d <= horizon; })
      .sort((a, b) => (dayOf(a.datetime) ?? '').localeCompare(dayOf(b.datetime) ?? ''))
      .slice(0, this.config.maxPerKind);
    for (const m of upcomingMeetings) {
      out.push({
        quote: `${nameOf.get(m.clientId) ?? 'A client'} — meeting: ${m.title ?? m.datetimeRaw}`,
        date: dayOf(m.datetime) ?? today,
        clientId: m.clientId,
        noteId: m.noteId ?? '',
      });
    }

    // Upcoming key dates (deadlines, launches, birthdays) within the window, soonest first.
    const upcomingDates = keyDates
      .filter((k) => k.date !== null && k.date >= floor && k.date <= horizon && k.description.trim())
      .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))
      .slice(0, this.config.maxPerKind);
    for (const k of upcomingDates) {
      out.push({
        quote: `${nameOf.get(k.clientId) ?? 'A client'} — ${k.description.trim()}`,
        date: k.date ?? today,
        clientId: k.clientId,
        noteId: k.noteId,
      });
    }

    return out;
  }
}
