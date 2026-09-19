import type { Extraction, ExtractedPromise, ExtractedPerson, Requirement } from '../services/extraction/types.js';

/** Per-note scoring counts for the quality gate. */
export interface NoteScore {
  promises: { tp: number; fp: number; fn: number };
  people: { tp: number; fp: number; fn: number };
  requirements: { tp: number; fp: number; fn: number }; // REQ-CERT: the new `requirements` field
  dates: { resolvedExpected: number; expectedResolvable: number };
  fabricatedPromises: number; // predicted promises with no matching expected
  guessedDates: number; // predicted a specific date where the truth is null
  mergedPeople: number; // two people who must stay distinct were collapsed into one
  falseCertainties: number; // a promise the key marks low-confidence returned as high — an unconfirmed guess presented as a fact
  leakedValues: number; // REDACT-5: a forbidden sensitive value/fragment appeared in the model output
  nullNamedPeople: number; // Rule 5: a person emitted with a null/empty name (a role-only reference) — never allowed
  // REQ-CERT diagnostics (the requirements regression risks, tracked distinctly):
  requirementFalsePositives: number; // a concern/complaint/question/speculation emitted AS a requirement — the flagged concern↔requirement leak. Alias of requirements.fp, surfaced by name.
  requirementDateErrors: number; // a MATCHED requirement whose stated_on ≠ the key's (Rule 8 / DATE-REF: stated_on must be the note's reference date, not today's real clock)
  requirementConfInflation: number; // a MATCHED requirement the key marks low returned as high — a conditional/vague need presented as firm (Rule 8 false certainty)
}

function tokens(s: string): Set<string> {
  return new Set(
    s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 2),
  );
}

function jaccard(a: string, b: string): number {
  const A = tokens(a);
  const B = tokens(b);
  if (A.size === 0 && B.size === 0) return 1;
  const inter = [...A].filter((x) => B.has(x)).length;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

function promiseMatches(p: ExtractedPromise, e: ExtractedPromise): boolean {
  return p.owner === e.owner && jaccard(p.text, e.text) >= 0.34;
}

function personMatches(p: ExtractedPerson, e: ExtractedPerson): boolean {
  return !!e.name && (p.name ?? '').trim().toLowerCase() === e.name.trim().toLowerCase();
}

/** A predicted requirement matches an expected one on the meaning of the need. We compare
 *  the verbatim `requirement_raw` (the phrase the rule pins) OR the normalised `text`, taking
 *  the stronger of the two — the model may phrase `text` differently but should quote the same
 *  raw span. 0.34 mirrors the promise threshold. */
function requirementMatches(p: Requirement, e: Requirement): boolean {
  return Math.max(jaccard(p.requirement_raw, e.requirement_raw), jaccard(p.text, e.text)) >= 0.34;
}

/** Score one predicted extraction against the known-correct expected. `mustNotMerge`
 *  lists name pairs that must appear as two DISTINCT people (never collapsed). */
export function scoreNote(
  expected: Extraction,
  actual: Extraction | null,
  mustNotMerge: Array<[string, string]> = [],
  forbidden: string[] = [],
): NoteScore {
  const score: NoteScore = {
    promises: { tp: 0, fp: 0, fn: 0 },
    people: { tp: 0, fp: 0, fn: 0 },
    requirements: { tp: 0, fp: 0, fn: 0 },
    dates: { resolvedExpected: 0, expectedResolvable: 0 },
    fabricatedPromises: 0,
    guessedDates: 0,
    mergedPeople: 0,
    falseCertainties: 0,
    leakedValues: 0,
    nullNamedPeople: 0,
    requirementFalsePositives: 0,
    requirementDateErrors: 0,
    requirementConfInflation: 0,
  };

  const predicted = actual ?? {
    summary: '',
    promises: [],
    people: [],
    personal_facts: [],
    key_dates: [],
    concerns: [],
    next_steps: [],
    requirements: [],
    meeting: null,
  };

  // Promises.
  const matchedExpected = new Set<number>();
  for (const p of predicted.promises) {
    const idx = expected.promises.findIndex((e, i) => !matchedExpected.has(i) && promiseMatches(p, e));
    if (idx >= 0) {
      matchedExpected.add(idx);
      score.promises.tp += 1;
      // Guessed date: truth says null but the model produced a specific date.
      if (expected.promises[idx]!.due_date === null && p.due_date !== null) score.guessedDates += 1;
      // False certainty: truth is uncertain (low) but the model asserted it high —
      // presenting an unconfirmed guess as a fact (spec principle, now gate-enforced).
      if (expected.promises[idx]!.confidence === 'low' && p.confidence === 'high') score.falseCertainties += 1;
    } else {
      score.promises.fp += 1;
      score.fabricatedPromises += 1;
      // A fabricated promise's date is part of the fabrication (scored by the aggregate
      // fabrication bar), NOT a separate guessed date. Double-counting it here would let a
      // dated phantom re-fail the per-run-zero guessed bar, undoing the ruling that
      // fabrication is aggregate-only. guessedDates is reserved for MATCHED promises.
    }
  }
  score.promises.fn = expected.promises.length - matchedExpected.size;

  // Dates resolvable: expected promises/key_dates whose date should resolve to a value.
  const expectedDated = [
    ...expected.promises.map((p) => ({ truth: p.due_date, hasPhrase: p.due_raw !== null })),
    ...expected.key_dates.map((d) => ({ truth: d.date, hasPhrase: d.date_raw !== null })),
  ];
  for (const d of expectedDated) {
    if (d.truth !== null) score.dates.expectedResolvable += 1;
  }
  // Count key_date guessed dates too (truth null but predicted a value).
  for (const pd of predicted.key_dates) {
    const match = expected.key_dates.find((e) => jaccard(pd.description, e.description) >= 0.34);
    if (match && match.date === null && pd.date !== null) score.guessedDates += 1;
  }

  // People.
  const matchedPeople = new Set<number>();
  for (const p of predicted.people) {
    const idx = expected.people.findIndex((e, i) => !matchedPeople.has(i) && personMatches(p, e));
    if (idx >= 0) {
      matchedPeople.add(idx);
      score.people.tp += 1;
    } else {
      score.people.fp += 1;
    }
  }
  score.people.fn = expected.people.length - matchedPeople.size;

  // Rule 5: a person with a null/empty name is a role-only reference — never allowed.
  score.nullNamedPeople = predicted.people.filter((p) => (p.name ?? '').trim() === '').length;

  // Merges: each pair that must stay distinct is a violation unless BOTH names
  // appear as separate predicted people (collapsing two mentions into one fails).
  const hasName = (name: string): boolean => {
    const n = name.trim().toLowerCase();
    return predicted.people.some((p) => (p.name ?? '').trim().toLowerCase() === n);
  };
  for (const [a, b] of mustNotMerge) {
    if (!(hasName(a) && hasName(b))) score.mergedPeople += 1;
  }

  // Requirements (REQ-CERT). tp/fp/fn drive precision/recall; fp is the concern↔requirement leak
  // (a complaint, question or rep speculation emitted as a stated need) — the flagged regression.
  const expectedReqs = expected.requirements ?? [];
  const predictedReqs = predicted.requirements ?? [];
  const matchedReqs = new Set<number>();
  for (const p of predictedReqs) {
    const idx = expectedReqs.findIndex((e, i) => !matchedReqs.has(i) && requirementMatches(p, e));
    if (idx >= 0) {
      matchedReqs.add(idx);
      score.requirements.tp += 1;
      const e = expectedReqs[idx]!;
      // Rule 8: stated_on must be the note's reference date. A matched requirement with the wrong
      // stated_on is the DATE-REF regression the 8th (import-dated) fixture exists to catch.
      if ((p.stated_on ?? null) !== (e.stated_on ?? null)) score.requirementDateErrors += 1;
      // A conditional/vague need (key = low) returned high is a requirement false certainty.
      if (e.confidence === 'low' && p.confidence === 'high') score.requirementConfInflation += 1;
    } else {
      score.requirements.fp += 1;
    }
  }
  score.requirements.fn = expectedReqs.length - matchedReqs.size;
  score.requirementFalsePositives = score.requirements.fp;

  if (forbidden.length) {
    const blob = JSON.stringify(predicted).toLowerCase();
    for (const f of forbidden) if (blob.includes(f.toLowerCase())) score.leakedValues += 1;
  }

  return score;
}

// ── Receipt scoring (RECEIPTS-v0.9.5 Task 5): gate source_span / source_message_at automatically ──

const RECEIPT_TYPES = ['promises', 'people', 'personal_facts', 'key_dates'] as const;

/**
 * A non-verbatim span is still FAITHFUL if ≥70% of its Latin tokens appear in the source.
 * Derivation (v0.9.5 cert, owner ruling 3): a code-switched span the model re-scripts from
 * Devanagari/Arabic into Latin transliteration is NOT a fabrication, but a byte-only match
 * false-flagged it. 0.70 is the level that passed the known transliteration/reorder cases while
 * still catching genuinely invented text (which shares far fewer tokens). Non-Latin script is
 * stripped by the tokenizer, so a purely non-Latin span is judged by verbatim containment (below).
 */
const SPAN_FAITHFUL_MIN_TOKEN_OVERLAP = 0.7;

function normContains(span: string, note: string): boolean {
  const n = (s: string) => s.toLowerCase().replace(/[‘’“”]/g, "'").replace(/\s+/g, ' ').trim();
  return n(note).includes(n(span));
}
function latinTokens(s: string): string[] {
  // Strips non-Latin script (Arabic/Devanagari → spaces), leaving Latin/number tokens only.
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 1);
}

/** Transliteration-aware: byte-verbatim (quote/space/case-normalised) OR ≥70% Latin-token overlap. */
export function spanFaithful(span: string, note: string): boolean {
  if (normContains(span, note)) return true;
  const spanToks = latinTokens(span);
  if (spanToks.length === 0) return false; // no Latin tokens and not verbatim → cannot vouch for it
  const noteSet = new Set(latinTokens(note));
  const hit = spanToks.filter((t) => noteSet.has(t)).length;
  return hit / spanToks.length >= SPAN_FAITHFUL_MIN_TOKEN_OVERLAP;
}

export interface ReceiptScore {
  spansEmitted: number;
  /** non-null span NOT faithful to the source — zero-tolerance, as serious as a fabricated date (Rule 9). */
  spansFabricated: number;
  /** source_message_at non-null when the source has NO per-message timestamps (voice/paste) — a wrong fact. */
  messageAtOnAmbiguous: number;
  /** source_message_at value absent from a timestamped source — a made-up message time (where determinable). */
  messageAtNotInSource: number;
}

/** The receipt gate bars (zero-tolerance, per the source-receipt doctrine, Rule 9). */
export const GATE_RECEIPTS = { maxFabricatedSpans: 0, maxMessageAtOnAmbiguous: 0 };

/**
 * Score a predicted extraction's receipts against the SOURCE it was drawn from.
 * `sourceHasMessageTimestamps` is true only for an imported chat (per-message "[timestamp]" lines);
 * false for voice/paste, where source_message_at MUST be null (Rule 9).
 */
export function scoreReceipts(
  sourceText: string,
  actual: Extraction | null,
  sourceHasMessageTimestamps: boolean,
): ReceiptScore {
  const s: ReceiptScore = { spansEmitted: 0, spansFabricated: 0, messageAtOnAmbiguous: 0, messageAtNotInSource: 0 };
  if (!actual) return s;
  const items: Array<{ source_span?: string | null; source_message_at?: string | null }> = [];
  for (const t of RECEIPT_TYPES) {
    const arr = (actual as unknown as Record<string, unknown>)[t];
    if (Array.isArray(arr)) items.push(...(arr as Array<{ source_span?: string | null; source_message_at?: string | null }>));
  }
  if (actual.meeting) items.push(actual.meeting);
  for (const it of items) {
    const span = it.source_span;
    if (typeof span === 'string' && span.trim()) {
      s.spansEmitted += 1;
      if (!spanFaithful(span, sourceText)) s.spansFabricated += 1;
    }
    const at = it.source_message_at;
    if (at != null && String(at).trim()) {
      if (!sourceHasMessageTimestamps) {
        s.messageAtOnAmbiguous += 1;
      } else if (!sourceText.includes(String(at)) && !sourceText.includes(String(at).slice(0, 16))) {
        // The chat renders "[<timestamp>] …"; a source_message_at not present there is invented.
        s.messageAtNotInSource += 1;
      }
    }
  }
  return s;
}

export function aggregateReceipts(scores: ReceiptScore[]): ReceiptScore {
  const sum = (pick: (s: ReceiptScore) => number) => scores.reduce((a, s) => a + pick(s), 0);
  return {
    spansEmitted: sum((s) => s.spansEmitted),
    spansFabricated: sum((s) => s.spansFabricated),
    messageAtOnAmbiguous: sum((s) => s.messageAtOnAmbiguous),
    messageAtNotInSource: sum((s) => s.messageAtNotInSource),
  };
}

export interface FieldMetrics {
  precision: number;
  recall: number;
}

function metrics(tp: number, fp: number, fn: number): FieldMetrics {
  const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
  return { precision, recall };
}

export interface AggregateMetrics {
  promises: FieldMetrics;
  people: FieldMetrics;
  requirements: FieldMetrics;
  fabricatedPromises: number;
  guessedDates: number;
  mergedPeople: number;
  falseCertainties: number;
  leakedValues: number;
  nullNamedPeople: number;
  requirementTp: number; // matched requirements — with requirementFalsePositives gives scored = tp+fp
  requirementFalsePositives: number;
  requirementDateErrors: number;
  requirementConfInflation: number;
  notes: number;
}

export function aggregate(scores: NoteScore[]): AggregateMetrics {
  const sum = (pick: (s: NoteScore) => number) => scores.reduce((a, s) => a + pick(s), 0);
  return {
    promises: metrics(sum((s) => s.promises.tp), sum((s) => s.promises.fp), sum((s) => s.promises.fn)),
    people: metrics(sum((s) => s.people.tp), sum((s) => s.people.fp), sum((s) => s.people.fn)),
    requirements: metrics(sum((s) => s.requirements.tp), sum((s) => s.requirements.fp), sum((s) => s.requirements.fn)),
    fabricatedPromises: sum((s) => s.fabricatedPromises),
    guessedDates: sum((s) => s.guessedDates),
    mergedPeople: sum((s) => s.mergedPeople),
    falseCertainties: sum((s) => s.falseCertainties),
    leakedValues: sum((s) => s.leakedValues),
    nullNamedPeople: sum((s) => s.nullNamedPeople),
    requirementTp: sum((s) => s.requirements.tp),
    requirementFalsePositives: sum((s) => s.requirementFalsePositives),
    requirementDateErrors: sum((s) => s.requirementDateErrors),
    requirementConfInflation: sum((s) => s.requirementConfInflation),
    notes: scores.length,
  };
}
