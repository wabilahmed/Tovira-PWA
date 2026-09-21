import type { ClientRepository } from '../../ports/client-repository.js';
import type { NoteRepository } from '../../ports/note-repository.js';
import type { FactsRepository } from '../../ports/facts-repository.js';
import type { UnansweredQuestion } from '../import/unanswered.js';
import { isStalePromise } from '../facts/promise-lifecycle.js';
import { extractionState } from '../notes/extraction-state.js';

/**
 * Day-One Book Scan — the "Relationship X-Ray" (P5-3b). Scans a rep's seeded
 * history and reveals what's been missed: open promises, unanswered client
 * questions, going-cold gaps, upcoming dates.
 *
 * This fires day-one (unlike the volume-gated pattern intelligence) because every
 * finding is an EXTRACTED FACT WITH A RECEIPT — a quote + date from the rep's own
 * conversation — not a statistic on a thin sample. The trust doctrine holds at the
 * most fragile moment (first impressions): every item carries its receipt,
 * promises are framed "worth checking" (never "you never did this"), and a thin
 * seed gets an honest empty state, never a fabricated finding.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export type BookScanKind = 'open_promise' | 'unanswered_question' | 'going_cold' | 'upcoming_date';

export interface BookScanReceipt {
  /** A quote from the rep's own conversation. Always non-empty. */
  quote: string;
  /** A date tying the receipt to reality. Always present. */
  date: string | null;
}

export interface BookScanItem {
  kind: BookScanKind;
  /** [BOOKSCAN-STREAM] A STABLE, UNIQUE identity for this finding, so the streaming client can key it
   *  without colliding (the old kind|client|quote|date key dropped null-span / same-message duplicates).
   *  For a finding backed by a single fact row it is that row's id (promise/keyDate); for one with no
   *  single backing row it is a stable composite (unanswered: noteId:index; going-quiet: clientId). With
   *  the `kind` prefix on the client it is globally unique. */
  id: string;
  clientId: string;
  clientName: string;
  headline: string;
  receipt: BookScanReceipt;
  /** Promises are always 'worth_checking' — the rep may have delivered off-channel. */
  framing: 'worth_checking' | 'informational';
}

/**
 * [BOOKSCAN-STREAM] Account-wide extraction progress over IMPORTED CHATS (whatsapp_export notes) —
 * so the streaming scan can show "N of M analysed" and, crucially, an unambiguous still-working vs
 * finished signal. On day one (empty account) this equals the rep's import. A FAILED chat stays in
 * `totalChats` (never silently reduces the denominator) and is surfaced as `failedChats`.
 */
export interface ScanProgress {
  totalChats: number; // all imported chats — the denominator; includes failed, never shrinks
  extractedChats: number; // done
  pendingChats: number; // still queued or processing — the scan is working iff this is > 0
  failedChats: number; // extraction failed (needs_review / import_failed) — shown, never dropped
  done: boolean; // nothing left queued/processing (settled: done or failed)
}

export interface BookScanReport {
  items: BookScanItem[];
  isEmpty: boolean;
  message: string | null;
  invitation: string;
  /** How many WhatsApp chat exports the book has read — the scan's third meta figure. */
  chatsRead: number;
  /** [BOOKSCAN-STREAM] streaming progress over imported chats (see ScanProgress). */
  scanProgress: ScanProgress;
  /** [PROMISE-STALE] Open promises overdue past the window — NOT listed individually (a seven-year
   *  import would flood the reveal); surfaced as a single count of "older ones" so the curated Book
   *  Scan shows the recoverable ones and honestly acknowledges the rest. */
  stalePromises: number;
}

export interface BookScanConfig {
  coldThresholdDays: number;
  upcomingWindowDays: number;
  /** [PROMISE-STALE] days overdue after which an open promise is a COUNT, not a listed item. Default 90. */
  promiseStaleThresholdDays?: number;
}

const INVITATION =
  "That was one relationship. Export your next most important chat and I'll X-ray that one too.";

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function snippet(text: string, max = 140): string {
  const t = text.trim();
  return t.length <= max ? t : `${t.slice(0, max).trimEnd()}…`;
}

export class BookScanService {
  constructor(
    private readonly repos: { clients: ClientRepository; notes: NoteRepository; facts: FactsRepository },
    private readonly config: BookScanConfig,
  ) {}

  /**
   * A shareable Book Scan card (P5-6): COUNTS ONLY. Never a client name, quote,
   * company, or any identifier — privacy is the whole game with a shared card.
   */
  async shareCard(userId: string, nowMs: number): Promise<{ openPromises: number; unansweredQuestions: number; goingCold: number; upcomingDates: number; total: number }> {
    const report = await this.scan(userId, nowMs);
    const count = (k: BookScanKind): number => report.items.filter((i) => i.kind === k).length;
    return {
      openPromises: count('open_promise'),
      unansweredQuestions: count('unanswered_question'),
      goingCold: count('going_cold'),
      upcomingDates: count('upcoming_date'),
      total: report.items.length,
    };
  }

  async scan(userId: string, nowMs: number): Promise<BookScanReport> {
    const items: BookScanItem[] = [];
    const clients = await this.repos.clients.listByUser(userId);
    const nameOf = new Map(clients.map((c) => [c.id, c.name]));

    // 1. Open promises — worth checking (the rep may have delivered off-channel). [PROMISE-STALE] Only
    // the RECOVERABLE ones (overdue within the window) are listed; ones overdue past it are counted,
    // not listed, so importing seven years of history is a curated reveal rather than 40 red rows.
    const staleThreshold = this.config.promiseStaleThresholdDays ?? 90;
    const promises = await this.repos.facts.listPromisesByUser(userId);
    let stalePromises = 0;
    for (const p of promises) {
      if (p.done) continue;
      if (isStalePromise(p, nowMs, staleThreshold)) { stalePromises += 1; continue; }
      items.push({
        kind: 'open_promise',
        id: p.id, // the promise row id — unique per promise, independent of quote/date
        clientId: p.clientId,
        clientName: nameOf.get(p.clientId) ?? 'Unknown',
        headline: `Worth checking: did you ${p.text}?`,
        receipt: { quote: p.text, date: p.dueDate ?? isoDate(p.createdAt) },
        framing: 'worth_checking',
      });
    }

    // 2. Unanswered client questions + 3. going-cold — one pass over each client's notes.
    const coldCutoff = nowMs - this.config.coldThresholdDays * DAY_MS;
    let chatsRead = 0;
    // [BOOKSCAN-STREAM] account-wide extraction progress over imported chats.
    let extractedChats = 0;
    let pendingChats = 0;
    let failedChats = 0;
    for (const c of clients) {
      const clientNotes = await this.repos.notes.listByClient(userId, c.id); // most-recent first
      chatsRead += clientNotes.filter((n) => n.source === 'whatsapp_export').length;
      for (const n of clientNotes) {
        if (n.source === 'whatsapp_export') {
          const st = extractionState(n);
          if (st === 'done') extractedChats += 1;
          else if (st === 'failed') failedChats += 1;
          else pendingChats += 1; // queued | processing — still working
        }
      }
      for (const n of clientNotes) {
        const ex = n.extracted as { unanswered_questions?: UnansweredQuestion[] } | null;
        const questions = ex?.unanswered_questions ?? [];
        // No fact row backs an unanswered question (it lives inside the note's extracted blob), so key it
        // by note id + its INDEX in that note's array — stable (extraction is idempotent per note, order
        // preserved) and unique per note, even when two questions share the same text/date.
        for (let qi = 0; qi < questions.length; qi++) {
          const q = questions[qi]!;
          if (!q.question.trim()) continue;
          items.push({
            kind: 'unanswered_question',
            id: `${n.id}:${qi}`,
            clientId: c.id,
            clientName: c.name,
            headline: `${c.name} asked something and the thread went quiet`,
            receipt: { quote: q.question.trim(), date: q.sentAt ?? isoDate(n.createdAt) },
            framing: 'worth_checking',
          });
        }
      }
      // Going cold: quiet past the threshold AND we have a note to quote as a receipt.
      if (c.lastTouchedAt < coldCutoff && clientNotes.length > 0) {
        const last = clientNotes[0]!;
        const lastText =
          last.messages && last.messages.length > 0
            ? last.messages[last.messages.length - 1]!.body
            : last.rawText ?? '';
        if (lastText.trim()) {
          items.push({
            kind: 'going_cold',
            id: c.id, // one going-quiet finding per client; the client id is its stable, unique key
            clientId: c.id,
            clientName: c.name,
            headline: `${c.name} has gone quiet — worth a nudge?`,
            receipt: { quote: snippet(lastText), date: isoDate(last.createdAt) },
            framing: 'informational',
          });
        }
      }
    }

    // 4. Upcoming dates — resolved dates inside the window (never a guessed date).
    const today = isoDate(nowMs);
    const horizon = isoDate(nowMs + this.config.upcomingWindowDays * DAY_MS);
    const keyDates = await this.repos.facts.listKeyDatesByUser(userId);
    for (const kd of keyDates) {
      if (!kd.date || !kd.description.trim()) continue; // no receipt → don't fabricate one
      if (kd.date >= today && kd.date <= horizon) {
        items.push({
          kind: 'upcoming_date',
          id: kd.id, // the key-date row id — unique per date
          clientId: kd.clientId,
          clientName: nameOf.get(kd.clientId) ?? 'Unknown',
          headline: `Upcoming: ${kd.description}`,
          receipt: { quote: kd.description.trim(), date: kd.date },
          framing: 'informational',
        });
      }
    }

    const isEmpty = items.length === 0;
    return {
      items,
      isEmpty,
      message: isEmpty
        ? chatsRead === 0
          ? "Nothing to scan yet — export your first WhatsApp chat and I'll X-ray it for you."
          : "Not much here yet — export another chat and I'll scan it too."
        : null,
      invitation: INVITATION,
      chatsRead,
      stalePromises,
      scanProgress: {
        totalChats: extractedChats + pendingChats + failedChats,
        extractedChats,
        pendingChats,
        failedChats,
        done: pendingChats === 0, // settled — nothing left queued/processing (failed counts as settled)
      },
    };
  }
}
