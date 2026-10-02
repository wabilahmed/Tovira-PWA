/**
 * [CORRECTIONS-WIRE / NO-TRAINING-RETENTION] Record a human VERDICT on a model-extracted item.
 *
 * A verdict is confirm | reject | edit. We record WHICH fact, the verdict, and (for edits) the KIND of
 * correction and, for date edits, the day-delta — never the before/after text. [2026-10-02] The policy
 * is that conversation-derived content is not retained; the corrected fact lives in `facts`, and a rep's
 * term corrections feed the operational `rep_glossary` (the before/after is used to compute the pair and
 * the delta, then discarded — never stored in corrections).
 *
 * TWO doctrines are non-negotiable:
 *  1. ISOLATION — a verdict write must NEVER break the rep's action. Every call is wrapped; a failure is
 *     logged and swallowed (same treatment as the delete-confirmation email hook).
 *  2. The verdict/kind/delta are derived DETERMINISTICALLY from the edit; no model call, no free text.
 */
import type { CorrectionRepository, CorrectionKind, Verdict } from '../../ports/correction-repository.js';
import type { ExtractionLogRepository } from '../../ports/extraction-log-repository.js';
import type { RepGlossaryRepository } from '../../ports/rep-glossary-repository.js';

/** Fields that are dates (edit → date_wrong + a day-delta). */
const DATE_FIELDS = new Set(['due_date', 'datetime', 'date', 'key_date']);
/** Fields that reassign a fact to another party (edit → wrong_person). */
const PERSON_FIELDS = new Set(['owner', 'subject', 'person', 'sender', 'reports_to']);
/** Non-term fields never become glossary substitutions (numeric/date/confidence). */
const NON_TERM_FIELDS = new Set(['due_date', 'due_raw', 'datetime', 'datetime_raw', 'confidence']);
const MAX_TERM_LEN = 40; // mirrors the rep_glossary DB check

export interface VerdictDeps {
  corrections: CorrectionRepository;
  extractionLog: Pick<ExtractionLogRepository, 'findPromptVersionByNote'>;
  /** [NO-TRAINING-RETENTION] the operational per-rep glossary — edit term-pairs are upserted here. Only
   *  the edit path uses it; confirm/reject-only callers (meetings, ask-capture) may omit it. */
  glossary?: RepGlossaryRepository;
  now?: () => number;
}

export interface VerdictEntry {
  noteId: string;
  entityType: string; // 'promise' | 'meeting' | 'ask_capture' | ...
  entityId: string;
  verdict: Verdict;
  /** The fact field edited (edits only); '' for a whole-fact confirm/reject. */
  field: string;
  /** The field's values — used ONLY to derive kind/delta/glossary, never stored. Omit for confirm/reject. */
  before?: string | null;
  after?: string | null;
}

/** The correction kind for a verdict. confirm → null; reject → should_not_exist; edit → inferred from
 *  the field (date → date_wrong; person reassignment → wrong_person; else → wrong_value). */
function kindOf(entry: VerdictEntry): CorrectionKind | null {
  if (entry.verdict === 'confirm') return null;
  if (entry.verdict === 'reject') return 'should_not_exist';
  if (DATE_FIELDS.has(entry.field)) return 'date_wrong';
  if (PERSON_FIELDS.has(entry.field)) return 'wrong_person';
  return 'wrong_value';
}

/** Corrected date minus original date, in whole days. Null unless both parse as dates. */
function dateDelta(before: string | null | undefined, after: string | null | undefined): number | null {
  if (!before || !after) return null;
  const b = Date.parse(before);
  const a = Date.parse(after);
  if (Number.isNaN(b) || Number.isNaN(a)) return null;
  return Math.round((a - b) / 86_400_000);
}

/** True when an edit's before/after is a term-sized pair worth carrying to the glossary. */
function isGlossaryPair(entry: VerdictEntry): boolean {
  if (entry.verdict !== 'edit' || NON_TERM_FIELDS.has(entry.field)) return false;
  const b = entry.before;
  const a = entry.after;
  return !!b && !!a && b !== a && b.length <= MAX_TERM_LEN && a.length <= MAX_TERM_LEN;
}

/**
 * Record one verdict. Tenant-scoped. Resolves the prompt version that produced the fact (P7-2) unless the
 * caller already has it. NEVER throws — the rep's action is already decided by the time this runs.
 */
export async function recordVerdict(
  deps: VerdictDeps,
  userId: string,
  entry: VerdictEntry,
  promptVersion?: string | null,
): Promise<void> {
  try {
    const kind = kindOf(entry);
    const dateDeltaDays = kind === 'date_wrong' ? dateDelta(entry.before, entry.after) : null;
    // A rep's term correction feeds the operational glossary; the before/after is then discarded.
    if (deps.glossary && isGlossaryPair(entry)) {
      await deps.glossary.upsert(userId, entry.before!, entry.after!, (deps.now ?? Date.now)());
    }
    const pv =
      promptVersion !== undefined
        ? promptVersion
        : await deps.extractionLog.findPromptVersionByNote(userId, entry.noteId);
    await deps.corrections.record(userId, {
      noteId: entry.noteId,
      entityType: entry.entityType,
      entityId: entry.entityId,
      field: entry.field,
      verdict: entry.verdict,
      correctionKind: kind,
      dateDeltaDays,
      promptVersion: pv,
    });
  } catch (err) {
    // Swallow — a lost verdict row is acceptable; a blocked rep action is not.
    console.warn(
      `[verdict] write failed for ${entry.entityType} ${entry.entityId} (rep action unaffected): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}
