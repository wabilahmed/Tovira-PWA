import type { Embedder } from '../../ports/embedder.js';
import type { NoteRepository, SimilarNote } from '../../ports/note-repository.js';
import type { ModelClient, ModelUsage } from '../../ports/model.js';
import type { RecallMetrics } from '../metrics/recall-metrics.js';
import type { RecallMessage, RecallSessionRepository } from '../../ports/recall-session-repository.js';
import { callCostUsd, USD_TO_AED } from '../metrics/model-budget.js';
import { estimateTokens } from '../extraction/prompt.js';

/**
 * Conversational recall (P4-8): answer a rep's question from their own notes.
 * Trust rules under interrogation: every answer cites receipts (verbatim quote +
 * date from a stored note); when nothing relevant is retrieved the answer is an
 * honest "I don't have that" — never a fabrication. Retrieval is capped (top-k)
 * so a huge book never triggers an unbounded-context call (cost guard).
 */

export interface Receipt {
  quote: string;
  date: string;
  clientId: string;
  noteId: string;
}

export interface RecallAnswer {
  answer: string;
  receipts: Receipt[];
}

export interface RecallConfig {
  topK: number;
  minSimilarity: number;
  /** [RECALL-TOPK] Hard cap on the TOTAL retrieved token budget, independent of item count —
   *  five long notes can exceed twenty short ones, so top-k alone is not a cost bound. */
  maxRetrievalTokens: number;
  /** [ASK-SESSION] Verbatim conversation window — the last N messages (rep + Tovira). Default 20. */
  historyWindow?: number;
  /** A session ends after this idle gap; a later turn starts a fresh one. Default 30 min. */
  sessionIdleMs?: number;
}

const DEFAULT_HISTORY_WINDOW = 20;
const DEFAULT_SESSION_IDLE_MS = 30 * 60 * 1000;

/** [ASK-SESSION] History is for INTERPRETING the current turn, not a backlog to work through.
 *  Stated in the variable message so a claim can't be re-asserted without re-retrieving its receipt. */
const HISTORY_DIRECTIVE =
  'The conversation so far is provided for context only — use it to understand what the latest question refers to. Answer only the latest question. Do not revisit, re-answer, or summarise earlier turns, and do not volunteer answers to questions that were already answered.';

const NO_ANSWER = "I don't have that on record.";
const MAX_QUOTE = 280;

const SYSTEM = `You answer a salesperson's question using ONLY the excerpts from their own notes provided below. Quote what was actually said and when. If the excerpts do not contain the answer, reply exactly "I don't have that on record." Never invent facts, names, dates, or commitments that are not in the excerpts.`;

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Keep receipts whose cumulative excerpt tokens stay within `budget`; always keep at least the
 *  first (the closest match) so a huge single note still yields a grounded, bounded answer. */
function capByTokenBudget(receipts: Receipt[], budget: number): Receipt[] {
  const kept: Receipt[] = [];
  let used = 0;
  for (const r of receipts) {
    const cost = estimateTokens(`(${r.date}) ${r.quote}`);
    if (kept.length > 0 && used + cost > budget) break;
    kept.push(r);
    used += cost;
  }
  return kept;
}

function toReceipt(m: SimilarNote): Receipt {
  const text = (m.note.rawText ?? '').trim();
  return {
    quote: text.length > MAX_QUOTE ? `${text.slice(0, MAX_QUOTE)}…` : text,
    date: isoDate(m.note.createdAt),
    clientId: m.note.clientId,
    noteId: m.note.id,
  };
}

export class RecallService {
  constructor(
    private readonly embedder: Embedder,
    private readonly notes: NoteRepository,
    private readonly model: ModelClient,
    private readonly config: RecallConfig = { topK: 5, minSimilarity: 0.2, maxRetrievalTokens: 1200 },
    /** [RECALL-METRICS] per-turn cost recorder. Optional — recall runs unchanged without it. */
    private readonly metrics?: RecallMetrics,
    /** Model id for pricing the recorded turn (recall runs on Haiku). */
    private readonly modelId: string = 'claude-haiku-4-5-20251001',
    /** [ASK-SESSION] Conversation store. Optional — recall is single-shot without it. */
    private readonly sessions?: RecallSessionRepository,
  ) {}

  /** [RECALL-METRICS] record this turn's shape + cost. Recall used to discard res.usage entirely. */
  private recordTurn(userId: string, excerpts: string, turnIndex: number, historyTokens: number, usage?: ModelUsage): void {
    if (!this.metrics) return;
    const u = usage ?? { inputTokens: 0, outputTokens: 0 };
    const costAed = callCostUsd(this.modelId, {
      inputTokens: u.inputTokens,
      outputTokens: u.outputTokens,
      cacheCreationInputTokens: u.cacheCreationInputTokens,
      cacheReadInputTokens: u.cacheReadInputTokens,
    }) * USD_TO_AED;
    this.metrics.record({
      userId,
      turnIndex,
      retrievalTokens: estimateTokens(excerpts),
      historyTokens,
      inputTokens: u.inputTokens,
      outputTokens: u.outputTokens,
      cachedTokens: u.cacheReadInputTokens ?? 0,
      costAed,
    });
  }

  async ask(userId: string, question: string, nowMs: number = Date.now()): Promise<RecallAnswer> {
    if (!question.trim()) return { answer: NO_ANSWER, receipts: [] };

    // [ASK-SESSION] Resolve the rep's active conversation (idle → fresh session) and load the
    // verbatim window. History is continuity only — it interprets the current turn, never a source
    // of truth, and the answer is grounded ONLY in THIS turn's retrieval (below).
    let sessionId: string | undefined;
    let history: RecallMessage[] = [];
    if (this.sessions) {
      sessionId = await this.sessions.activeSession(userId, nowMs, this.config.sessionIdleMs ?? DEFAULT_SESSION_IDLE_MS);
      history = await this.sessions.recentMessages(userId, sessionId, this.config.historyWindow ?? DEFAULT_HISTORY_WINDOW);
    }

    const embedding = await this.embedder.embed(question);
    const matches = await this.notes.searchSimilarByUser(userId, embedding, this.config.topK);
    const relevant = matches.filter((m) => m.similarity >= this.config.minSimilarity && (m.note.rawText ?? '').trim());

    let answer: string;
    let receipts: Receipt[] = [];
    if (relevant.length === 0) {
      // Nothing in the vault → honest "I don't have that", even if history mentioned it (history is
      // never treated as a source of truth). Still recorded so the conversation stays coherent.
      answer = NO_ANSWER;
    } else {
      // [RECALL-TOPK] top-k caps the ITEM count (the DB LIMIT); this caps the total TOKEN budget so a
      // few long notes can't blow up the context. Always at least the top match.
      receipts = capByTokenBudget(relevant.map(toReceipt), this.config.maxRetrievalTokens);
      const excerpts = receipts.map((r, i) => `[${i + 1}] (${r.date}) ${r.quote}`).join('\n');
      const current = this.sessions
        ? `${HISTORY_DIRECTIVE}\n\nQUESTION: ${question}\n\nEXCERPTS:\n${excerpts}`
        : `QUESTION: ${question}\n\nEXCERPTS:\n${excerpts}`;
      try {
        const res = await this.model.complete({
          system: SYSTEM, // byte-identical prefix; the window + directive ride the variable messages
          messages: [...history.map((m) => ({ role: m.role, content: m.content })), { role: 'user', content: current }],
          maxTokens: 512,
        });
        answer = res.text.trim() || NO_ANSWER;
        const turnIndex = history.filter((m) => m.role === 'user').length + 1;
        const historyTokens = estimateTokens(history.map((m) => m.content).join('\n'));
        this.recordTurn(userId, excerpts, turnIndex, historyTokens, res.usage);
      } catch {
        // Never fabricate on a model failure — fall back to the verbatim receipts.
        answer = 'Here is what I found in your notes.';
      }
    }

    // Persist the exchange so pronouns/follow-ups resolve next turn.
    if (this.sessions && sessionId) {
      await this.sessions.appendMessage(userId, sessionId, 'user', question, nowMs);
      await this.sessions.appendMessage(userId, sessionId, 'assistant', answer, nowMs);
    }
    return { answer, receipts };
  }
}
