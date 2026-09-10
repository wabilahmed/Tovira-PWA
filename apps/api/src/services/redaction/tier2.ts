/**
 * [TIER2-INPUT] Narrow, anchored suppression of Tier-2 (special-category) content from the STORED
 * training-log input.
 *
 * Option A's ruling: health (and other special-category data) is never EXTRACTED in any field — the
 * model's Rule 7 enforces that on OUTPUT, and it is certified. The gap the audit found is that the
 * raw INPUT, stored verbatim in extraction_logs, still carried the special-category sentence. This
 * scrubs the stored copy so the corpus we intend to TRAIN on does not archive a third party's health,
 * religion, sexual orientation, or criminal history.
 *
 * THIS RUNS ON THE STORED LOG INPUT ONLY — never on note.rawText and never on the userMessage sent to
 * the model. Extraction is therefore unchanged (no prompt change, no re-certification); only the
 * archived training copy is scrubbed.
 *
 * PRECISION OVER RECALL, BY DESIGN. Tier-2 is a semantic category, not a checksum like a card number:
 * a broad regex would over-suppress and CORRUPT the training data by deleting context the extraction
 * depended on (the task's explicit warning). So every pattern here is ANCHORED — it requires an
 * explicit lexical anchor ("diagnosed with", "is Muslim", "convicted of"), never a bare ambiguous
 * noun ("operation", "cancel", "party"). The cost is recall: this is a best-effort defence-in-depth
 * net on the stored copy, NOT a guarantee that every Tier-2 phrase is caught. For a HARD guarantee
 * when an actual training set is built, exclude flagged rows rather than trust mutation — see
 * TRAINING-FIX-REPORT.md. The model's Rule 7 remains the precise instrument for output.
 */

export type Tier2Kind = 'health' | 'religion' | 'orientation' | 'criminal';

export interface Tier2Result {
  redacted: string;
  counts: Partial<Record<Tier2Kind, number>>;
  total: number;
}

interface Rule {
  kind: Tier2Kind;
  re: RegExp;
  placeholder: string;
}

// Each pattern is anchored on an explicit marker so ambiguous business language is left untouched
// ("business operation", "cancel the order", "the party next week", "healthy margin", "sick of waiting").
const RULES: Rule[] = [
  // HEALTH — a named condition only when anchored to a person being in that state.
  {
    kind: 'health',
    re: /\b(?:diagnosed with|diagnosis of|suffers? from|suffering from|battling|undergoing treatment for|being treated for|recovering from)\s+[a-z][\w'’ -]{2,40}/gi,
    placeholder: '[health detail removed]',
  },
  {
    kind: 'health',
    re: /\b(?:has|had|have|with)\s+(?:terminal\s+)?(?:cancer|diabetes|HIV|AIDS|leukaemia|leukemia|depression|anxiety disorder|bipolar disorder|schizophrenia|dementia|alzheimer'?s|kidney disease|heart disease|a heart condition)\b/gi,
    placeholder: '[health detail removed]',
  },
  {
    kind: 'health',
    re: /\b(?:prescribed|on|taking)\s+(?:insulin|chemotherapy|chemo|antidepressants?|dialysis|medication for [a-z][\w'’ -]{2,30})\b/gi,
    placeholder: '[health detail removed]',
  },
  {
    kind: 'health',
    re: /\b(?:chemotherapy|undergoing chemo|on dialysis|is pregnant|her pregnancy|his treatment for|had a miscarriage|admitted to hospital|hospitalised|hospitalized|surgery for [a-z][\w'’ -]{2,30})\b/gi,
    placeholder: '[health detail removed]',
  },
  // RELIGION — anchored to identification/practice, not a bare noun ("a Christian name" is untouched).
  {
    kind: 'religion',
    re: /\b(?:is|are|a|an|devout|practising|practicing|observant)\s+(?:Muslim|Christian|Catholic|Protestant|Hindu|Buddhist|Jewish|Sikh|atheist|agnostic)\b/gi,
    placeholder: '[religion removed]',
  },
  {
    kind: 'religion',
    re: /\b(?:prays at|worships at|attends)\s+(?:the\s+)?(?:mosque|church|temple|synagogue|gurdwara)\b/gi,
    placeholder: '[religion removed]',
  },
  // SEXUAL ORIENTATION — anchored to identification.
  {
    kind: 'orientation',
    re: /\b(?:is|identifies as|came out as)\s+(?:gay|lesbian|bisexual|homosexual|transgender|trans)\b/gi,
    placeholder: '[personal detail removed]',
  },
  // CRIMINAL HISTORY — anchored to the legal act.
  {
    kind: 'criminal',
    re: /\b(?:convicted of|arrested for|charged with|on bail for|out on parole|in prison for|served time for|has a criminal record)\b(?:\s+[a-z][\w'’ -]{2,30})?/gi,
    placeholder: '[criminal-history detail removed]',
  },
];

/**
 * Scrub anchored Tier-2 spans from `text`, returning the scrubbed text + per-kind counts. Idempotent
 * (placeholders contain no anchors, so a second pass is a no-op). Never throws.
 */
export function redactTier2(text: string): Tier2Result {
  const counts: Partial<Record<Tier2Kind, number>> = {};
  let out = text;
  for (const { kind, re, placeholder } of RULES) {
    out = out.replace(re, () => {
      counts[kind] = (counts[kind] ?? 0) + 1;
      return placeholder;
    });
  }
  const total = Object.values(counts).reduce((a, b) => a + (b ?? 0), 0);
  return { redacted: out, counts, total };
}
