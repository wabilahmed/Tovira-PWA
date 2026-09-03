import type { CacheTtl, ModelClient } from '../../ports/model.js';
import type { ClientRepository } from '../../ports/client-repository.js';
import type { NoteRepository } from '../../ports/note-repository.js';
import type { FactsRepository } from '../../ports/facts-repository.js';
import type { Embedder } from '../../ports/embedder.js';
import type { ExtractionLogRepository } from '../../ports/extraction-log-repository.js';
import type { CorrectionRepository } from '../../ports/correction-repository.js';
import type { MeetingRepository } from '../../ports/meeting-repository.js';
import type { Meeting } from './types.js';
import { zonedWallClockToInstant } from '../time/zone.js';
import { buildGlossary } from './glossary.js';
import type { ModelRouter } from './model-router.js';
import type { ExtractionLimiter } from './limiter.js';
import { EXTRACTION_SYSTEM_PROMPT, PROMPT_VERSION, buildUserMessage } from './prompt.js';
import { asExtraction } from './validate.js';
import { extractJsonObject } from './parse.js';
import { detectUnansweredQuestions } from '../import/unanswered.js';
import type { Extraction } from './types.js';

export interface ExtractOutcome {
  status: string;
  flagged?: boolean;
}

interface Attempt {
  parsed: unknown | null;
  raw: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

/** Parse a message timestamp (ISO or WhatsApp DD/MM/YYYY) to YYYY-MM-DD, or null. */
function parseMsgDate(sentAt: string | null | undefined): string | null {
  if (!sentAt) return null;
  const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(sentAt);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const wa = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(sentAt); // DD/MM/YYYY (WhatsApp)
  if (wa) return `${wa[3]}-${wa[2]!.padStart(2, '0')}-${wa[1]!.padStart(2, '0')}`;
  return null;
}

/** DATE-REF: the reference date for resolving a note's relative dates is the date its
 *  CONTENT was created — for an imported chat, the latest message's timestamp (NOT the
 *  import date); for fresh capture, the note's creation date; falling back to `today`. */
export function referenceDateFor(note: { messages?: { sentAt: string | null }[] | null }, today: string): string {
  const msgDates = (note.messages ?? []).map((m) => parseMsgDate(m.sentAt)).filter((d): d is string => d !== null);
  // An imported chat resolves against its latest message date; fresh capture against the
  // caller's today (which IS the capture date). Never the import-time now for imports.
  return msgDates.length ? msgDates.sort().at(-1)! : today;
}

/**
 * Turn a note's raw text into structured facts (P1-6). The prompt is [cacheable
 * prefix] → [variable message with today's date]. On malformed/invalid output we
 * retry ONCE, then flag the note for review and write NOTHING structured. Every
 * extraction — success OR failure — writes exactly one training-log row (P1-8).
 */
export class ExtractionService {
  private readonly now = () => Date.now();

  constructor(
    private readonly model: ModelClient,
    private readonly clients: ClientRepository,
    private readonly notes: NoteRepository,
    private readonly facts: FactsRepository,
    private readonly embedder: Embedder,
    private readonly logs: ExtractionLogRepository,
    /** Model id recorded in the log (e.g. 'stub' or 'claude-haiku-4-5-…'). */
    private readonly modelId: string = 'stub',
    /** Corrections drive the per-rep glossary (P4-9). Optional. */
    private readonly corrections?: CorrectionRepository,
    /** Per-account model routing (P5-7). Optional — falls back to model/modelId. */
    private readonly router?: ModelRouter,
    /** Trial extraction ceiling (P5-1). Optional — unlimited when absent. */
    private readonly limiter?: ExtractionLimiter,
    /** Prompt-cache lifetime for the (byte-identical) system prefix. Defaults to
     *  the cheaper-write 5-minute tier; production passes config ('1h'). */
    private readonly cacheTtl: CacheTtl = '5m',
    /** NUDGE-UNCONFIRMED: persist an extraction-proposed meeting (confirmed from the proposal),
     *  idempotently per note. Optional — extraction runs unchanged without it. */
    private readonly meetings?: Pick<MeetingRepository, 'findByNoteId' | 'create'>,
    /** Rep timezone, to resolve a proposed meeting's wall-clock to an absolute instant. */
    private readonly meetingTimezone?: (userId: string) => Promise<string>,
  ) {}

  /** Persist a proposed meeting for a note (idempotent per note). `confirmed` comes from the
   *  proposal: a "locked in" meeting is confirmed:true (immediately nudgeable); a mere proposal is
   *  confirmed:false and waits for the rep. The wall-clock time is resolved on the rep's clock. */
  private async persistProposedMeeting(userId: string, noteId: string, clientId: string, meeting: Meeting): Promise<void> {
    if (!this.meetings) return;
    if (await this.meetings.findByNoteId(userId, noteId)) return; // already persisted — idempotent
    let datetime = meeting.datetime;
    if (datetime) {
      const tz = this.meetingTimezone ? await this.meetingTimezone(userId) : 'Asia/Dubai';
      try { datetime = zonedWallClockToInstant(datetime, tz).toISOString(); } catch { /* keep raw */ }
    }
    await this.meetings.create(userId, {
      clientId,
      datetime,
      datetimeRaw: meeting.datetime_raw,
      title: null,
      confirmed: meeting.confirmed,
      noteId,
    });
  }

  async extractNote(userId: string, noteId: string, today: string): Promise<ExtractOutcome> {
    const note = await this.notes.findByIdForUser(userId, noteId);
    if (!note) return { status: 'not_found' };
    if (!note.rawText || !note.rawText.trim()) return { status: note.status };

    // Trial seeding bound (P5-1): stop before spending on a model call. Nothing
    // breaks — the note stays pending and the route explains the ceiling.
    if (this.limiter && !(await this.limiter.allow(userId))) {
      return { status: 'trial_limit', flagged: true };
    }

    const client = await this.clients.findByIdForUser(userId, note.clientId);
    // Per-rep glossary from THIS user's corrections (P4-9). Tenant-scoped, so it
    // can never influence another rep; injected into the variable message only.
    const glossary = this.corrections ? buildGlossary(await this.corrections.listByUser(userId)) : [];
    const referenceDate = referenceDateFor(note, today);
    const userMessage = buildUserMessage({
      today: referenceDate,
      clientName: client?.name ?? 'Unknown',
      source: note.source,
      text: note.rawText,
      glossary,
    });

    // Resolve the model ONCE (P5-7): a retry must use the same model as the
    // original — never mixed mid-sequence.
    const route = this.router ? await this.router.resolve(userId) : { model: this.model, modelId: this.modelId };

    const start = this.now();
    let last: Attempt = { parsed: null, raw: null, inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };
    let extraction: Extraction | null = null;
    for (let attempt = 0; attempt < 2 && !extraction; attempt++) {
      last = await this.call(route.model, userMessage);
      extraction = last.parsed ? asExtraction(last.parsed) : null;
    }

    let status: string;
    if (!extraction) {
      await this.notes.update(userId, noteId, { status: 'needs_review' });
      status = 'needs_review';
    } else {
      // Chat imports carry speaker-attributed messages → detect client questions
      // the rep never answered (P1-6). Deterministic; never fabricated.
      extraction.unanswered_questions = note.messages ? detectUnansweredQuestions(note.messages) : [];
      // Embedding is the semantic-search substrate, NOT the facts. If the embedder is
      // down or denied (e.g. Bedrock model access not yet granted), we must still save
      // the extracted facts — "never lose a recording". The note is 'extracted' with a
      // null vector; recall for it is degraded until a re-embed. Best-effort, never fatal.
      let embedding: number[] | null = null;
      try {
        embedding = await this.embedder.embed(note.rawText);
      } catch (err) {
        console.warn(`[extract] embedding failed for note ${noteId}; saving facts without a vector`, err);
      }
      // DATE-INVARIANT: a promise can never be due BEFORE its note's reference date (a
      // fresh note cannot commit to the past; a historical import legitimately can, since
      // its reference is the message date). Enforced here at write time — a model rule can
      // slip, a write-time check cannot. On violation: null the date, keep the raw phrase,
      // drop to low, route to confirmation; log so the rate is observable.
      for (const promise of extraction.promises) {
        if (promise.due_date !== null && promise.due_date < referenceDate) {
          console.warn(`[date-invariant] note ${noteId}: due_date ${promise.due_date} < reference ${referenceDate} — nulled, low, queued`);
          promise.due_date = null;
          promise.confidence = 'low';
        }
      }
      await this.notes.update(userId, noteId, { extracted: extraction, status: 'extracted', embedding });
      await this.facts.saveExtraction(userId, {
        noteId,
        clientId: note.clientId,
        promises: extraction.promises,
        keyDates: extraction.key_dates,
      });
      // NUDGE-UNCONFIRMED: persist a proposed meeting so it can be confirmed and nudged.
      // Best-effort — a failure here must never lose the extracted facts (never lose a recording).
      if (this.meetings && extraction.meeting) {
        try {
          await this.persistProposedMeeting(userId, noteId, note.clientId, extraction.meeting);
        } catch (err) {
          console.warn(`[extract] proposed-meeting persist failed for note ${noteId}`, err);
        }
      }
      status = 'extracted';
    }

    // Exactly one log row per extraction, success or failure.
    await this.logs.log(userId, {
      noteId,
      promptVersion: PROMPT_VERSION,
      model: route.modelId,
      input: userMessage,
      rawOutput: last.raw,
      status,
      inputTokens: last.inputTokens,
      outputTokens: last.outputTokens,
      latencyMs: this.now() - start,
      cacheCreationTokens: last.cacheCreationTokens,
      cacheReadTokens: last.cacheReadTokens,
    });

    return extraction ? { status } : { status, flagged: true };
  }

  private async call(model: ModelClient, userMessage: string): Promise<Attempt> {
    let raw: string | null = null;
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheCreationTokens = 0;
    let cacheReadTokens = 0;
    try {
      const res = await model.complete({
        system: EXTRACTION_SYSTEM_PROMPT,
        // The prefix is large (>4k tokens) and byte-identical every call — cache
        // it so repeat extractions read the prefix instead of re-billing it.
        cacheSystemPrompt: true,
        cacheTtl: this.cacheTtl,
        messages: [{ role: 'user', content: userMessage }],
        maxTokens: 2048,
        // NB: temperature is deprecated for claude-sonnet-5 (the API 400s on any
        // value), so it is intentionally NOT set here — the model manages its own
        // low-variance sampling. The port still forwards temperature for models
        // that accept it; determinism is certified by the two-run P1-9 gate.
      });
      raw = res.text;
      inputTokens = res.usage?.inputTokens ?? 0;
      outputTokens = res.usage?.outputTokens ?? 0;
      cacheCreationTokens = res.usage?.cacheCreationInputTokens ?? 0;
      cacheReadTokens = res.usage?.cacheReadInputTokens ?? 0;
    } catch {
      return { parsed: null, raw: null, inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens };
    }
    const parsed = extractJsonObject(raw);
    return { parsed, raw, inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens };
  }
}
