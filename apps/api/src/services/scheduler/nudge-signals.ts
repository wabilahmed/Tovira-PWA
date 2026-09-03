import type { ClientRepository } from '../../ports/client-repository.js';
import type { FactsRepository, PromiseRecord } from '../../ports/facts-repository.js';
import type { NoteRepository } from '../../ports/note-repository.js';
import type { MeetingRecord } from '../../ports/meeting-repository.js';
import type { UnansweredQuestion } from '../import/unanswered.js';
import { formatMeetingWhen, type NudgeSignals } from './nudge-content.js';

const DAY = 86_400_000;

export interface NudgeSignalsDeps {
  clients: Pick<ClientRepository, 'findByIdForUser'>;
  facts: Pick<FactsRepository, 'listPromisesByUser'>;
  notes: Pick<NoteRepository, 'listByClient'>;
  timezoneFor: (userId: string) => Promise<string>;
  coldThresholdDays: number;
}

/**
 * [NUDGE-CONTENT] Gather the one most-actionable signal for a meeting's client, in the fixed
 * priority open promise → unanswered question → cooling. Reads only what the priority needs
 * (short-circuits), so a rep with a live promise never pays for the notes scan. Everything is a
 * fact already on file — nothing here invents anything.
 */
export class NudgeSignalsProvider {
  constructor(private readonly deps: NudgeSignalsDeps) {}

  async signalsFor(userId: string, meeting: MeetingRecord, nowMs: number): Promise<NudgeSignals> {
    const [client, tz] = await Promise.all([
      this.deps.clients.findByIdForUser(userId, meeting.clientId),
      this.deps.timezoneFor(userId),
    ]);
    const clientName = client?.name ?? 'your client';
    const whenLabel = meeting.datetime
      ? formatMeetingWhen(Date.parse(meeting.datetime), tz, nowMs)
      : meeting.datetimeRaw || 'soon';

    // 1. An open promise the REP owes (not done). Most actionable: overdue first, then soonest.
    const promises = (await this.deps.facts.listPromisesByUser(userId)).filter(
      (p) => p.clientId === meeting.clientId && p.owner === 'rep' && !p.done,
    );
    const topPromise = pickPromise(promises)?.text;

    // 2. An unanswered client question (structural, from the chat-export extraction).
    let topQuestion: string | undefined;
    if (!topPromise) {
      const notes = await this.deps.notes.listByClient(userId, meeting.clientId); // newest-first
      for (const n of notes) {
        const qs = (n.extracted as { unanswered_questions?: UnansweredQuestion[] } | null)?.unanswered_questions ?? [];
        const q = qs.find((x) => x.question?.trim());
        if (q) { topQuestion = q.question.trim(); break; }
      }
    }

    // 3. Cooling: silent past the threshold (elapsed time is a fact — the one place claret dominates).
    let silentDays = 0;
    if (!topPromise && !topQuestion && client) {
      const days = Math.floor((nowMs - client.lastTouchedAt) / DAY);
      if (days >= this.deps.coldThresholdDays) silentDays = days;
    }

    return { clientName, clientId: meeting.clientId, whenLabel, topPromise, topQuestion, silentDays };
  }
}

function pickPromise(promises: PromiseRecord[]): PromiseRecord | undefined {
  const dated = promises.filter((p) => p.dueDate).sort((a, b) => a.dueDate!.localeCompare(b.dueDate!));
  return dated[0] ?? promises[0];
}
