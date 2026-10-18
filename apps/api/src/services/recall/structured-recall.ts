import type { FactsRepository } from '../../ports/facts-repository.js';
import type { MeetingRepository } from '../../ports/meeting-repository.js';
import type { ClientRepository } from '../../ports/client-repository.js';
import type { RequirementRepository } from '../../ports/requirement-repository.js';
import type { NoteRepository, NoteRecord } from '../../ports/note-repository.js';
import type { Receipt } from './recall-service.js';
import type { ExtractedPerson, PersonalFact } from '../extraction/types.js';
import type { UnansweredQuestion } from '../import/unanswered.js';
import type { Restriction } from '../erasure/restriction.js';
import { restrictNote } from '../erasure/restrict-note.js';
import { queryTerms, termHits } from './query-terms.js';

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
 *
 * [P21-A1 / FEAT-05] Beyond promises/meetings/key dates it also reaches requirements, people, personal
 * facts and unanswered client questions — the rows a "who asked about parking?" answer lives in. Those
 * are QUESTION-MATCHED (English + Arabic content words, see query-terms.ts): a matching row is flagged
 * `matched` so the recall service can put it ahead of the vector notes in the token budget. Unmatched
 * rows of those kinds are not dumped into every answer.
 */
export interface StructuredRecallDeps {
  facts: Pick<FactsRepository, 'listPromisesByUser' | 'listKeyDatesByUser'>;
  meetings: Pick<MeetingRepository, 'listByUser'>;
  clients: Pick<ClientRepository, 'listByUser'>;
  /** [P21-A1] Optional: open requirements across clients. */
  requirements?: Pick<RequirementRepository, 'listOpenByUser'>;
  /** [P21-A1] Optional: notes, for the people / personal facts / unanswered questions in their extraction. */
  notes?: Pick<NoteRepository, 'listByClient'>;
}

/** A structured receipt; `matched` = it shares content words with the question (rank it first). */
export type StructuredReceipt = Receipt & { matched?: boolean };

export interface StructuredQuery {
  /** The rep's question — rows sharing its content words are returned (and flagged `matched`). */
  question?: string;
  /** [P21-A2] Limit every row to these clients (a follow-up about "them"). Empty/absent = all clients. */
  clientIds?: string[];
  /** Active erasure-window restriction, applied to note-derived rows. */
  restriction?: Restriction;
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
/** Question-matched rows are short and precise; this caps them so a broad word can't flood the context. */
const MAX_MATCHED = 12;
/** Notes not yet in the vault (an unconfirmed Ask capture) never feed an answer. */
const PENDING = 'pending_confirmation';

interface Row { receipt: Receipt; content: string; digest: boolean; clientOwned?: boolean }

/** [P21-A4] A question about the REP's own promises ("what have I promised", "my promises", "what do I
 *  owe", Arabic وعدت / وعودي). Client-owned promises are left out of its answer. */
const MY_PROMISES = /\b(?:i|i've|ive|i have|i'd)\s+(?:\w+\s+){0,2}?(?:promis\w*|owe|committed|commit)\b|\bmy\s+(?:promises?|commitments?)\b|وعدت|وعودي|التزاماتي/i;
export function asksAboutMyPromises(question: string): boolean {
  return MY_PROMISES.test(question);
}

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
  async forUser(userId: string, nowMs: number = Date.now(), query: StructuredQuery = {}): Promise<StructuredReceipt[]> {
    const [clients, promises, keyDates, meetings, reqs] = await Promise.all([
      this.deps.clients.listByUser(userId),
      this.deps.facts.listPromisesByUser(userId),
      this.deps.facts.listKeyDatesByUser(userId),
      this.deps.meetings.listByUser(userId),
      this.deps.requirements ? this.deps.requirements.listOpenByUser(userId) : Promise.resolve([]),
    ]);
    const scope = query.clientIds && query.clientIds.length > 0 ? new Set(query.clientIds) : null;
    const inScope = (clientId: string) => !scope || scope.has(clientId);
    const nameOf = new Map(clients.map((c) => [c.id, c.name]));
    const who = (clientId: string) => nameOf.get(clientId) ?? 'A client';
    const today = isoDate(nowMs);
    const horizon = isoDate(nowMs + this.config.windowDays * DAY_MS);
    const floor = isoDate(nowMs - this.config.graceDays * DAY_MS);
    const rows: Row[] = [];

    // Open promises across all clients — the soonest (and overdue) first; a promise with no date comes
    // after the dated ones. listPromisesByUser already returns canonicals only (no merged duplicates).
    const open = promises
      .filter((p) => !p.done && inScope(p.clientId))
      .sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'));
    // [P21-A4] The owner is carried: a client's promise reads as the client's, and a question about the
    // rep's own promises doesn't get the client's.
    const mine = query.question ? asksAboutMyPromises(query.question) : false;
    for (const p of open) {
      const clientOwned = p.owner === 'client';
      if (clientOwned && mine) continue;
      rows.push({
        clientOwned,
        receipt: {
          quote: clientOwned ? `${who(p.clientId)} promised to ${p.text}` : `${who(p.clientId)} — you promised to ${p.text}`,
          date: p.dueDate ?? dayOf(p.sourceMessageAt) ?? p.captureAt ?? isoDate(p.createdAt),
          clientId: p.clientId,
          noteId: p.noteId,
        },
        content: p.text,
        digest: true,
      });
    }

    // Upcoming meetings within the window, soonest first.
    const upcomingMeetings = meetings
      .filter((m) => { const d = dayOf(m.datetime); return d !== null && d >= floor && d <= horizon && inScope(m.clientId); })
      .sort((a, b) => (dayOf(a.datetime) ?? '').localeCompare(dayOf(b.datetime) ?? ''));
    for (const m of upcomingMeetings) {
      rows.push({
        receipt: {
          quote: `${who(m.clientId)} — meeting: ${m.title ?? m.datetimeRaw}`,
          date: dayOf(m.datetime) ?? today,
          clientId: m.clientId,
          noteId: m.noteId ?? '',
        },
        content: `${m.title ?? ''} ${m.datetimeRaw ?? ''}`,
        digest: true,
      });
    }

    // Upcoming key dates (deadlines, launches, birthdays) within the window, soonest first.
    const upcomingDates = keyDates
      .filter((k) => k.date !== null && k.date >= floor && k.date <= horizon && k.description.trim() && inScope(k.clientId))
      .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
    for (const k of upcomingDates) {
      rows.push({
        receipt: { quote: `${who(k.clientId)} — ${k.description.trim()}`, date: k.date ?? today, clientId: k.clientId, noteId: k.noteId },
        content: k.description,
        digest: true,
      });
    }

    // [P21-A1] Open requirements — what each client has STATED they need, quoted verbatim.
    for (const r of reqs) {
      if (!inScope(r.clientId)) continue;
      const phrase = (r.requirementRaw || r.text).trim();
      if (!phrase) continue;
      rows.push({
        receipt: { quote: `${who(r.clientId)} — needs: ${phrase}`, date: dayOf(r.statedOn) ?? isoDate(r.createdAt), clientId: r.clientId, noteId: r.noteId },
        content: `${r.text} ${r.requirementRaw}`,
        digest: false,
      });
    }

    // [P21-A1] People, personal facts and unanswered client questions live in each note's extraction.
    if (this.deps.notes) {
      for (const c of clients) {
        if (!inScope(c.id)) continue;
        for (const raw of await this.deps.notes.listByClient(userId, c.id)) {
          if (raw.status === PENDING) continue;
          const n: NoteRecord = query.restriction?.active ? restrictNote(raw, query.restriction) : raw;
          rows.push(...noteRows(n, c.name));
        }
      }
    }

    // Question-matched rows first (most terms hit, then the order above), capped.
    const terms = query.question ? queryTerms(query.question) : [];
    const matched = terms.length === 0 ? [] : rows
      .map((row, i) => ({ row, i, hits: termHits(terms, row.content) }))
      .filter((x) => x.hits > 0)
      .sort((a, b) => b.hits - a.hits || a.i - b.i)
      .slice(0, MAX_MATCHED)
      .map((x) => x.row);
    const taken = new Set(matched);
    const out: StructuredReceipt[] = matched.map((r) => ({ ...r.receipt, matched: true }));

    // The aggregate digest (promises / meetings / key dates), each kind capped, minus what matched.
    const perKind = (kind: (r: Row) => boolean) => rows.filter((r) => r.digest && kind(r) && !taken.has(r)).slice(0, this.config.maxPerKind);
    const isPromise = (r: Row) => r.clientOwned !== undefined;
    const isMeeting = (r: Row) => r.receipt.quote.includes(' — meeting: ');
    const digest = [...perKind(isPromise), ...perKind(isMeeting), ...perKind((r) => !isPromise(r) && !isMeeting(r))];
    out.push(...digest.map((r) => r.receipt));
    return out;
  }
}

/** [P21-A1] The people / personal-fact / unanswered-question rows of one note, each with its receipt. */
function noteRows(n: NoteRecord, clientName: string): Row[] {
  const ex = n.extracted as { people?: ExtractedPerson[]; personal_facts?: PersonalFact[]; unanswered_questions?: UnansweredQuestion[] } | null;
  if (!ex) return [];
  const noteDay = isoDate(n.createdAt);
  const rows: Row[] = [];
  for (const q of ex.unanswered_questions ?? []) {
    const question = q.question?.trim();
    if (!question) continue;
    rows.push({
      receipt: { quote: `${clientName} asked: ${question}`, date: dayOf(q.sentAt) ?? noteDay, clientId: n.clientId, noteId: n.id },
      content: question,
      digest: false,
    });
  }
  for (const p of ex.people ?? []) {
    if (!p.name?.trim()) continue;
    const role = p.role?.trim() ? ` (${p.role.trim()})` : '';
    const notes = p.notes?.trim() ? `: ${p.notes.trim()}` : '';
    rows.push({
      receipt: { quote: `${clientName} — ${p.name.trim()}${role}${notes}`, date: dayOf(p.source_message_at ?? null) ?? noteDay, clientId: n.clientId, noteId: n.id },
      content: `${p.name} ${p.role ?? ''} ${p.notes ?? ''} ${p.source_span ?? ''}`,
      digest: false,
    });
  }
  for (const f of ex.personal_facts ?? []) {
    if (!f.fact?.trim()) continue;
    rows.push({
      receipt: { quote: `${clientName} — ${f.subject?.trim() ? `${f.subject.trim()}: ` : ''}${f.fact.trim()}`, date: dayOf(f.source_message_at ?? null) ?? noteDay, clientId: n.clientId, noteId: n.id },
      content: `${f.subject ?? ''} ${f.fact} ${f.category ?? ''} ${f.source_span ?? ''}`,
      digest: false,
    });
  }
  return rows;
}
