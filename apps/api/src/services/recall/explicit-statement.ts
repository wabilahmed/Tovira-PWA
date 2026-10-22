/**
 * [P21-A3 / FEAT-06] Deterministic detection of an EXPLICIT statement of fact in Ask — the rep telling
 * Tovira something, not asking: "Remember that …", "Note that …", "Update: …", "FYI …", "X is now …"
 * (Arabic: تذكر أن / سجل أن / ملاحظة: / تحديث:). No model call, so it can't be missed by a flaky
 * classification. Conservative: anything phrased as a question ("Do you remember…", "Remember what…?",
 * "Is Sara now…?") is NOT a statement — questions must never become facts.
 */

const QUESTION_LEAD = /^(?:who|what|which|whose|when|where|why|how|is|are|was|were|do|does|did|can|could|would|should|will|has|have|had|any)\b/i;
const CUE = /^(?:please\s+)?(?:remember(?:\s+that)?|note(?:\s+that)?|noted|update|fyi|for the record)\b\s*[:,\-–—]?\s*/i;
const AR_CUE = /^(?:تذكر(?:\s+[أا]ن)?|سجل(?:\s+[أا]ن)?|ملاحظة\s*:|تحديث\s*:)\s*/;
const NOW_FORM = /\b(?:is|are)\s+now\b|['’]s\s+now\b/i;

function isQuestion(t: string): boolean {
  return /[?؟]\s*$/.test(t) || QUESTION_LEAD.test(t);
}

/** The statement body (cue removed) when `turn` is an explicit statement of fact; otherwise null. */
export function explicitStatement(turn: string): string | null {
  const t = turn.trim();
  if (!t || isQuestion(t)) return null;
  const cue = CUE.exec(t) ?? AR_CUE.exec(t);
  if (cue) {
    const body = t.slice(cue[0].length).trim();
    return body && !isQuestion(body) ? body : null;
  }
  return NOW_FORM.test(t) ? t : null;
}

const FIELD = /\b(budget|price|timeline|deadline|move-in date|phone number|phone|number|email|address|title|role|company|employer)\b/i;
const VALUE = /(?:\bto\b|\bis now\b|\bnow\b|\bis\b|:|=)\s*(.+?)[.!\s]*$/i;

/** [P39-6] The known field a statement sets and the value it sets it to, from the rep's own words — or null.
 *  To Confirm asks about exactly this ("Did Sara Khan's budget change to AED 2.2M?"). */
export function captureField(statement: string): { field: string; value: string } | null {
  const body = explicitStatement(statement) ?? statement.trim();
  const field = FIELD.exec(body);
  if (!field) return null;
  const value = VALUE.exec(body.slice(field.index + field[0].length));
  return value && value[1]!.trim() ? { field: field[1]!.toLowerCase(), value: value[1]!.trim() } : null;
}

/** A short handle for a client: the first real word of its name ("QA Sara Khan" → "Sara"). */
function shortName(clientName: string): string {
  return clientName.trim().split(/\s+/).find((w) => /^\p{L}{3,}$/u.test(w)) ?? clientName.trim();
}

/**
 * The one-line "what was held" for the reply and the To Confirm queue, built only from the rep's words:
 * "Sara's budget → 2.2M" when the statement sets a known field to a value, else "QA Sara Khan: <what
 * they said>". Never a paraphrase beyond trimming the cue and the client's name.
 */
export function captureSummary(statement: string, clientName: string): string {
  const body = explicitStatement(statement) ?? statement.trim();
  const set = captureField(statement);
  if (set) return `${shortName(clientName)}'s ${set.field} → ${set.value}`;
  const rest = body.toLowerCase().startsWith(clientName.toLowerCase()) ? body.slice(clientName.length).trim() : body;
  return `${clientName}: ${rest.replace(/[.!\s]+$/, '')}`;
}
