/**
 * [CORRECTIONS-WIRE] Record a human VERDICT on a model-extracted item as a correction row.
 *
 * The training log held the model's OUTPUT but almost none of the human judgement on it:
 * `corrections.record()` had a single caller (the promise-edit handler). This records EVERY
 * verdict — reject, confirm, edit — with the ORIGINAL extracted value, so the corpus carries
 * the human "no"/"yes"/"fix" that a distilled model learns from. The SAME rows are the live
 * proxy the Condition-4 monitor needs: rejection rate = rejected verdicts / extractions.
 *
 * TWO doctrines are non-negotiable here:
 *  1. ISOLATION — a verdict write must NEVER break the user's action. A rep rejecting a wrong
 *     fact must succeed even if the correction write throws (same treatment as the
 *     delete-confirmation email hook). Every call is wrapped; a failure is logged and swallowed.
 *  2. BEFORE, not just after — a correction without its original value is not training data.
 *     Rejections record the original in `before` (after = null); confirmations record the
 *     confirmed value in `before` (after = CONFIRMED); edits record the per-field before/after.
 */
import type { CorrectionRepository } from '../../ports/correction-repository.js';
import type { ExtractionLogRepository } from '../../ports/extraction-log-repository.js';

/** Verdict "fields" — sentinels, never real fact fields. Excluded from the per-rep glossary
 *  (buildGlossary treats them as non-term) so a verdict can never become a term substitution. */
export const REJECTED_FIELD = '__rejected__';
export const CONFIRMED_FIELD = '__confirmed__';

export interface VerdictDeps {
  corrections: CorrectionRepository;
  extractionLog: Pick<ExtractionLogRepository, 'findPromptVersionByNote'>;
}

export interface VerdictEntry {
  noteId: string;
  entityType: string; // 'promise' | 'meeting' | 'ask_capture' | …
  entityId: string;
  field: string; // REJECTED_FIELD | CONFIRMED_FIELD | a real field name for edits
  before: string | null;
  after: string | null;
}

/**
 * Record one verdict. Tenant-scoped via the repo. Resolves the prompt version that produced
 * the fact (P7-2) unless the caller already has it (edits resolve once for a multi-field loop).
 * NEVER throws — the user's action is already decided by the time this runs.
 */
export async function recordVerdict(
  deps: VerdictDeps,
  userId: string,
  entry: VerdictEntry,
  promptVersion?: string | null,
): Promise<void> {
  try {
    const pv =
      promptVersion !== undefined
        ? promptVersion
        : await deps.extractionLog.findPromptVersionByNote(userId, entry.noteId);
    await deps.corrections.record(userId, { ...entry, promptVersion: pv });
  } catch (err) {
    // Swallow — a lost training row is acceptable; a blocked rep action is not.
    console.warn(
      `[verdict] correction write failed for ${entry.entityType} ${entry.entityId} (user action unaffected): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

/** Compact, stable serialisation of an extracted promise — the "original value" a verdict records. */
export function serialisePromise(p: {
  text: string;
  owner: string | null;
  dueDate: string | null;
  dueRaw: string | null;
  confidence: string | null;
}): string {
  return JSON.stringify({
    text: p.text,
    owner: p.owner,
    due_date: p.dueDate,
    due_raw: p.dueRaw,
    confidence: p.confidence,
  });
}

/** Compact serialisation of a meeting verdict's original value. */
export function serialiseMeeting(m: {
  datetime: string | null;
  datetimeRaw: string | null;
  title: string | null;
}): string {
  return JSON.stringify({ datetime: m.datetime, datetime_raw: m.datetimeRaw, title: m.title });
}
