import type { CacheTtl, ModelClient } from '../../ports/model.js';
import type { ClientRepository } from '../../ports/client-repository.js';
import type { NoteRepository } from '../../ports/note-repository.js';
import type { FactsRepository } from '../../ports/facts-repository.js';
import type { Embedder } from '../../ports/embedder.js';
import type { ExtractionLogRepository } from '../../ports/extraction-log-repository.js';
import type { CorrectionRepository } from '../../ports/correction-repository.js';
import type { MeetingRepository } from '../../ports/meeting-repository.js';
import type { RequirementRepository, RequirementInput } from '../../ports/requirement-repository.js';
import type { MatchingService } from '../inventory/matching-service.js';
import type { Meeting, Requirement } from './types.js';
import { zonedWallClockToInstant } from '../time/zone.js';
import { buildGlossary } from './glossary.js';
import type { ModelRouter } from './model-router.js';
import type { ExtractionLimiter } from './limiter.js';
import { EXTRACTION_SYSTEM_PROMPT, PROMPT_VERSION, EXTRACTION_MAX_TOKENS, buildUserMessage } from './prompt.js';
import { asExtraction } from './validate.js';
import { extractJsonObject } from './parse.js';
import { detectUnansweredQuestions } from '../import/unanswered.js';
import { detectMisfilePostExtraction, nameMatches } from '../import/misfile.js';
import { callCostUsd, estimateEmbedUsd, USD_TO_AED } from '../metrics/model-budget.js';
import { redactTier2 } from '../redaction/tier2.js';
import type { ImportCostRecord } from '../metrics/import-cost-metrics.js';
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
  /** [COST-REMEASURE] Reasoning tokens (billed as output; now known to dominate) — tracked and
   *  priced separately from text so cost figures aren't blind to the biggest line. */
  thinkingTokens: number;
  /** [EXTRACT-STOPREASON] The output budget was spent without a text answer — max_tokens hit with no
   *  text, or a thinking-only response. A DISTINCT failure (the model produced nothing), not
   *  malformed JSON. Never retried as invalid JSON; raised loud + counted. */
  starved: boolean;
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

/** [ALIAS-NORMALISE + CLIENT-PERSON v0.9.4] Fold the chat counterpart (this client under a
 *  nickname/company alias) into the client's identity: the client IS a person (v0.9.4), so KEEP them
 *  in people[] but under their REAL client name — never the alias/nickname — and re-subject a personal
 *  fact about the alias to the real name. If the model emitted both the alias and the real name,
 *  collapse to one client entry. Mutates in place; never touches receipts/raw text (evidence stays
 *  verbatim). NB: pre-v0.9.4 this DROPPED the client from people[]; that stripped the client the
 *  certified ruling requires before it reached the vault (the BLIND-2 finding — the gate never sees
 *  this layer because extractForEval does not call it). */
export function normaliseCounterpart(
  extraction: { people?: Array<{ name?: string | null }>; personal_facts?: Array<{ subject?: string | null }> },
  clientName: string,
  aliases: string[],
): void {
  if (!clientName && aliases.length === 0) return;
  const isClient = (n: string | null | undefined): boolean =>
    !!n && (nameMatches(n, clientName) || aliases.some((a) => nameMatches(n, a)));
  if (Array.isArray(extraction.people)) {
    const seen = new Set<string>();
    extraction.people = extraction.people
      .map((p) => (isClient(p.name) ? { ...p, name: clientName } : p)) // the client is a person — keep, under the REAL name
      .filter((p) => { const k = (p.name ?? '').trim().toLowerCase(); if (k === '') return true; if (seen.has(k)) return false; seen.add(k); return true; }); // collapse an alias+real double
  }
  for (const f of extraction.personal_facts ?? []) {
    if (isClient(f.subject)) f.subject = clientName; // a fact about the alias is a fact about the client
  }
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
    /** INV-MATCH: the requirements spine. Optional — extraction runs unchanged without it. */
    private readonly requirements?: RequirementRepository,
    /** INV-MATCH: the matching engine, triggered on a new requirement (direction 1). Optional. */
    private readonly matching?: MatchingService,
    /** [COST-IMPORT-METRIC] rolling per-rep import cost sink. Optional — extraction runs unchanged. */
    private readonly importCost?: { record(r: ImportCostRecord): void },
    /** [SPEND-CAP] over-cap gate: when canSpend is false, extraction defers (note stays pending). */
    private readonly spendGate?: { canSpend(userId: string): Promise<boolean> },
    /** [ALIAS-NORMALISE] learned aliases for a client, to normalise counterpart attribution. */
    private readonly aliasesFor?: (userId: string, clientId: string) => Promise<string[]>,
    /** [EXTRACT-STOPREASON] observability sink for starved (no-text) extraction outputs. */
    private readonly health?: { recordStarvedOutput(): void },
  ) {}

  /** INV-MATCH: persist a note's requirements as spine rows, each with its own embedding, then
   *  trigger matching direction 1 (new requirement → existing stock) with the fresh vectors — pure
   *  vector retrieval, never a per-pairing model call. The embedding is Titan (one call per
   *  requirement), never Claude, and best-effort — a requirement with no vector is simply not
   *  matchable, never lost. Idempotent per note. */
  private async persistRequirements(userId: string, noteId: string, clientId: string, reqs: Requirement[]): Promise<void> {
    if (!this.requirements) return;
    const inputs: RequirementInput[] = [];
    const vectors: Array<number[] | null> = [];
    for (const r of reqs) {
      let embedding: number[] | null = null;
      try {
        embedding = await this.embedder.embed(r.requirement_raw || r.text);
      } catch (err) {
        console.warn(`[requirements] embed failed for note ${noteId}; requirement stored without a vector`, err);
      }
      inputs.push({ text: r.text, requirementRaw: r.requirement_raw, statedOn: r.stated_on, confidence: r.confidence, embedding });
      vectors.push(embedding);
    }
    const saved = await this.requirements.saveForNote(userId, noteId, clientId, inputs);
    if (this.matching) {
      for (let i = 0; i < saved.length; i++) {
        try {
          await this.matching.matchRequirement(userId, saved[i]!, vectors[i] ?? null);
        } catch (err) {
          console.warn(`[inv-match] requirement-side match failed for note ${noteId}`, err);
        }
      }
    }
  }

  /** Persist a proposed meeting for a note (idempotent per note). `confirmed` comes from the
   *  proposal: a "locked in" meeting is confirmed:true (immediately nudgeable); a mere proposal is
   *  confirmed:false and waits for the rep. The wall-clock time is resolved on the rep's clock. */
  /** MISFILE-POST (B2): store a soft move-suggestion when this note's people point only at another
   *  client. Deterministic (extracted people vs known people), conservative (needs zero overlap
   *  with the filed client AND a positive match elsewhere). Runs after `extracted` is persisted, so
   *  this note's own people are excluded from the filed client's set. */
  private async detectAndStoreMisfile(userId: string, noteId: string, clientId: string, extraction: Extraction): Promise<void> {
    const notePeople = (extraction.people ?? [])
      .map((p) => p.name)
      .filter((n): n is string => typeof n === 'string' && n.trim().length > 0);
    if (notePeople.length === 0) return;
    const namesOf = (notes: Array<{ id: string; extracted: unknown }>, excludeNoteId?: string): string[] => {
      const out = new Set<string>();
      for (const n of notes) {
        if (n.id === excludeNoteId) continue;
        const ex = n.extracted as { people?: Array<{ name?: unknown }> } | null;
        for (const p of ex?.people ?? []) if (typeof p.name === 'string' && p.name.trim()) out.add(p.name.trim());
      }
      return [...out];
    };
    const filedOther = namesOf(await this.notes.listByClient(userId, clientId), noteId);
    const otherClients = (await this.clients.listByUser(userId)).filter((c) => c.id !== clientId);
    const others: Array<{ id: string; name: string; people: string[] }> = [];
    for (const c of otherClients) {
      others.push({ id: c.id, name: c.name, people: namesOf(await this.notes.listByClient(userId, c.id)) });
    }
    const result = detectMisfilePostExtraction({ notePeople, filedClient: { id: clientId, name: '' }, filedClientOtherPeople: filedOther, others });
    const suggestion = result.status === 'suggest_move'
      ? { toClientId: result.to?.id ?? null, toClientName: result.to?.name ?? null, mentioned: result.mentioned, reason: result.reason, createdAt: this.now() }
      : null;
    await this.notes.update(userId, noteId, { moveSuggestion: suggestion });
  }

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

  async extractNote(userId: string, noteId: string, today: string, opts?: { holdForConfirmation?: boolean }): Promise<ExtractOutcome> {
    const note = await this.notes.findByIdForUser(userId, noteId);
    if (!note) return { status: 'not_found' };
    if (!note.rawText || !note.rawText.trim()) return { status: note.status };

    // Trial seeding bound (P5-1): stop before spending on a model call. Nothing
    // breaks — the note stays pending and the route explains the ceiling.
    if (this.limiter && !(await this.limiter.allow(userId))) {
      return { status: 'trial_limit', flagged: true };
    }
    // [SPEND-CAP] Over the per-account spend cap: DEFER extraction (the expensive, deferrable path).
    // Return before any model call — the raw note is already stored and simply stays pending; the
    // sweep drains it once the rep is under cap (next billing period, or an ops override). Never a
    // model call, never a lost note.
    if (this.spendGate && !(await this.spendGate.canSpend(userId))) {
      return { status: 'spend_capped', flagged: true };
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
    let last: Attempt = { parsed: null, raw: null, inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, thinkingTokens: 0, starved: false };
    let extraction: Extraction | null = null;
    // Total spend across attempts (a retry bills a second call) — the log keeps the final row's
    // tokens; the import-cost metric wants the whole import's spend.
    const spend = { calls: 0, input: 0, output: 0, thinking: 0, cacheWrite: 0, cacheRead: 0 };
    const spendClass = note.source === 'whatsapp_export' ? 'import' : 'extraction';
    for (let attempt = 0; attempt < 2 && !extraction; attempt++) {
      last = await this.call(route.model, userMessage, userId, spendClass);
      spend.calls += 1;
      spend.input += last.inputTokens;
      spend.output += last.outputTokens;
      spend.thinking += last.thinkingTokens;
      spend.cacheWrite += last.cacheCreationTokens;
      spend.cacheRead += last.cacheReadTokens;
      extraction = last.parsed ? asExtraction(last.parsed) : null;
      // [EXTRACT-STOPREASON] A starved response (budget spent on reasoning, no text) is a DISTINCT
      // failure — the model produced nothing, not malformed JSON. Do NOT retry it as invalid JSON
      // (a retry starves identically and burns the budget again); make it loud and observable so it
      // can never silently reach a user as it did before. This should not happen now that
      // EXTRACTION_MAX_TOKENS clears the reasoning budget — if it fires, the budget needs raising.
      if (last.starved) {
        console.error(`[extract] OUTPUT_STARVED note=${noteId} client=${note.clientId} model=${route.modelId} inputTokens=${last.inputTokens} outputTokens=${last.outputTokens} — max_tokens exhausted by reasoning, no text emitted; raise EXTRACTION_MAX_TOKENS`);
        this.health?.recordStarvedOutput();
        break;
      }
    }

    let status: string;
    if (!extraction) {
      await this.notes.update(userId, noteId, { status: 'needs_review' });
      status = 'needs_review';
    } else {
      // Chat imports carry speaker-attributed messages → detect client questions
      // the rep never answered (P1-6). Deterministic; never fabricated.
      extraction.unanswered_questions = note.messages ? detectUnansweredQuestions(note.messages) : [];
      // [ALIAS-NORMALISE] The chat counterpart IS this client, often under a nickname/company alias
      // ("Bubu DXB" → Imtinan). Normalise attribution into the vault: the counterpart is not a
      // separate STAKEHOLDER (drop them from people[]), and a personal fact about the alias is a fact
      // about the client (rewrite the subject to the real name). Receipts/quotes are raw note text
      // and are NEVER touched here — attribution is normalised, evidence is verbatim.
      if (this.aliasesFor) {
        const aliases = await this.aliasesFor(userId, note.clientId).catch(() => [] as string[]);
        normaliseCounterpart(extraction, client?.name ?? '', aliases);
      }
      // Embedding is the semantic-search substrate, NOT the facts. If the embedder is
      // down or denied (e.g. Bedrock model access not yet granted), we must still save
      // the extracted facts — "never lose a recording". The note is 'extracted' with a
      // null vector; recall for it is degraded until a re-embed. Best-effort, never fatal.
      // [ASK-CAPTURE] hold-for-confirmation: an Ask-captured statement is extracted by the CERTIFIED
      // engine (facts computed, training-log row written below) but held OUT of the vault — no
      // embedding (so recall retrieval, which requires a vector, can never surface it), no facts
      // spine, no meeting persist. It stays 'pending_confirmation' until the rep confirms; only then
      // is it embedded + committed. This is how "nothing enters the vault until confirmed" holds.
      const hold = opts?.holdForConfirmation === true;
      let embedding: number[] | null = null;
      if (!hold) {
        try {
          embedding = await this.embedder.embed(note.rawText);
        } catch (err) {
          console.warn(`[extract] embedding failed for note ${noteId}; saving facts without a vector`, err);
        }
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
      await this.notes.update(userId, noteId, { extracted: extraction, status: hold ? 'pending_confirmation' : 'extracted', embedding });
      if (!hold) {
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
        // INV-MATCH (A4): persist the requirements spine — each requirement as a row with its OWN
        // embedding (Titan, one call each — never a per-pairing model call), so matching is precise
        // and requirements have identity + lifecycle. Best-effort; never blocks the facts.
        if (this.requirements) {
          try {
            await this.persistRequirements(userId, noteId, note.clientId, extraction.requirements ?? []);
          } catch (err) {
            console.warn(`[extract] requirements persist failed for note ${noteId}`, err);
          }
        }
        // MISFILE-POST (B2): now the people are extracted, check — deterministically, no model
        // call — whether this note actually looks like it belongs to another client, and store a
        // soft suggestion for the confirmation queue. Best-effort; never loses the facts.
        try {
          await this.detectAndStoreMisfile(userId, noteId, note.clientId, extraction);
        } catch (err) {
          console.warn(`[misfile-post] detection failed for note ${noteId}`, err);
        }
      }
      status = hold ? 'pending_confirmation' : 'extracted';
    }

    // Exactly one log row per extraction, success or failure.
    // [TIER2-INPUT] The model saw the FULL userMessage (unchanged — no prompt change, no re-cert);
    // we scrub Tier-2 (special-category) content from the STORED training copy only, so the corpus we
    // train on never archives a third party's health/religion/orientation/criminal history. Narrow +
    // anchored (precision over recall) — a best-effort net, not a guarantee (see redactTier2 / report).
    const storedInput = redactTier2(userMessage).redacted;
    await this.logs.log(userId, {
      noteId,
      promptVersion: PROMPT_VERSION,
      model: route.modelId,
      input: storedInput,
      rawOutput: last.raw,
      status,
      inputTokens: last.inputTokens,
      outputTokens: last.outputTokens,
      latencyMs: this.now() - start,
      cacheCreationTokens: last.cacheCreationTokens,
      cacheReadTokens: last.cacheReadTokens,
    });

    // [COST-IMPORT-METRIC] A chat import is one heavy extraction call over the whole transcript;
    // record its real cost (extraction + a negligible embedding estimate), attributed to the rep,
    // so per-rep import spend is observable rather than estimated. Only imports — a daily note's
    // cost is already dominated by the cached prefix and is not the ceiling concern.
    if (note.source === 'whatsapp_export' && this.importCost) {
      const embedded = extraction !== null && opts?.holdForConfirmation !== true;
      const reqCount = embedded ? (extraction!.requirements?.length ?? 0) : 0;
      const extractionUsd = callCostUsd(route.modelId, {
        inputTokens: spend.input, outputTokens: spend.output,
        cacheCreationInputTokens: spend.cacheWrite, cacheReadInputTokens: spend.cacheRead,
      });
      const embedUsd = embedded ? estimateEmbedUsd(note.rawText.length, reqCount) : 0;
      this.importCost.record({
        userId, clientId: note.clientId, calls: spend.calls,
        inputTokens: spend.input, outputTokens: spend.output, thinkingTokens: spend.thinking,
        cachedTokens: spend.cacheRead, cacheWriteTokens: spend.cacheWrite,
        embeddingCalls: embedded ? 1 + reqCount : 0,
        costAed: (extractionUsd + embedUsd) * USD_TO_AED,
      });
    }

    return extraction ? { status } : { status, flagged: true };
  }

  private async call(model: ModelClient, userMessage: string, userId: string, spendClass: string): Promise<Attempt> {
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
        maxTokens: EXTRACTION_MAX_TOKENS, // reasoning + text share this budget (EXTRACT-MAXTOKENS)
        userId,
        spendClass, // 'import' for a chat import, 'extraction' for a daily note (SPEND-CAP)
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
      // [EXTRACT-STOPREASON] No text answer AND the budget went to reasoning / hit the cap → starved.
      const noText = !raw || !raw.trim();
      const starved = noText && (res.stopReason === 'max_tokens' || (res.usage?.thinkingTokens ?? 0) > 0);
      return { parsed: extractJsonObject(raw), raw, inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens, thinkingTokens: res.usage?.thinkingTokens ?? 0, starved };
    } catch {
      return { parsed: null, raw: null, inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens, thinkingTokens: 0, starved: false };
    }
  }
}
