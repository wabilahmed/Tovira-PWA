import type { ClientRepository } from '../../ports/client-repository.js';
import type { NoteRepository } from '../../ports/note-repository.js';
import type { FactsRepository } from '../../ports/facts-repository.js';
import type { UnansweredQuestion } from '../import/unanswered.js';

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
  clientId: string;
  clientName: string;
  headline: string;
  receipt: BookScanReceipt;
  /** Promises are always 'worth_checking' — the rep may have delivered off-channel. */
  framing: 'worth_checking' | 'informational';
}

export interface BookScanReport {
  items: BookScanItem[];
  isEmpty: boolean;
  message: string | null;
  invitation: string;
}

export interface BookScanConfig {
  coldThresholdDays: number;
  upcomingWindowDays: number;
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

  async scan(userId: string, nowMs: number): Promise<BookScanReport> {
    const items: BookScanItem[] = [];
    const clients = await this.repos.clients.listByUser(userId);
    const nameOf = new Map(clients.map((c) => [c.id, c.name]));

    // 1. Open promises — worth checking (the rep may have delivered off-channel).
    const promises = await this.repos.facts.listPromisesByUser(userId);
    for (const p of promises) {
      if (p.done) continue;
      items.push({
        kind: 'open_promise',
        clientId: p.clientId,
        clientName: nameOf.get(p.clientId) ?? 'Unknown',
        headline: `Worth checking: did you ${p.text}?`,
        receipt: { quote: p.text, date: p.dueDate ?? isoDate(p.createdAt) },
        framing: 'worth_checking',
      });
    }

    // 2. Unanswered client questions + 3. going-cold — one pass over each client's notes.
    const coldCutoff = nowMs - this.config.coldThresholdDays * DAY_MS;
    for (const c of clients) {
      const clientNotes = await this.repos.notes.listByClient(userId, c.id); // most-recent first
      for (const n of clientNotes) {
        const ex = n.extracted as { unanswered_questions?: UnansweredQuestion[] } | null;
        for (const q of ex?.unanswered_questions ?? []) {
          if (!q.question.trim()) continue;
          items.push({
            kind: 'unanswered_question',
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
        ? "Not much here yet — export another chat and I'll scan it too."
        : null,
      invitation: INVITATION,
    };
  }
}
