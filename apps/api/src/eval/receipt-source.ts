import { redactSensitive } from '../services/redaction/redact.js';
import type { EvalNote } from './eval-set.js';

/** [P50 · cert finding] The text a receipt must be faithful to: the note as the model saw it, after Tier-1 redaction
 *  (extractForEval redacts at ingest, as production does, and production stores the redacted text). Checking against
 *  the raw note called a verbatim quote of "[Emirates ID redacted]" fabricated. */
export function receiptSource(note: Pick<EvalNote, 'note'>): string {
  return redactSensitive(note.note).redacted;
}
