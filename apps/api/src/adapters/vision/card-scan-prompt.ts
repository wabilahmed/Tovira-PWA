import type { CardScanResult } from '../../ports/card-scanner.js';
import { extractJsonObject } from '../../services/extraction/parse.js';

/**
 * The vision instruction for a business-card scan. Same trust doctrine as the
 * extraction engine: a wrong fact is worse than a missing one. A field the model
 * cannot read clearly must be null — never guessed, never completed from a
 * plausible pattern. A non-card image is reported as such, not forced into a
 * contact. The output is a structured PROPOSAL the rep confirms; nothing is
 * saved on its own.
 */
export const CARD_SCAN_SYSTEM_PROMPT = `You read a photo of a single business card and return ONLY structured JSON. Rules:
- Output exactly this shape, nothing else: {"is_card": boolean, "name": string|null, "title": string|null, "phone": string|null, "email": string|null}.
- If the image is not a business card (a receipt, a screenshot, a landscape, a blank frame, an unreadable blur), return {"is_card": false, "name": null, "title": null, "phone": null, "email": null}.
- For a card, transcribe ONLY what is legible. Any field you cannot read with confidence — blurred, cut off, glare, absent from the card — MUST be null. Never guess, never infer, never "correct" a partial value, never invent a plausible email or phone from the name or company.
- Copy values verbatim as printed (keep the phone's formatting, the email's exact spelling). Do not normalise or reformat.
- Output only the JSON object. No prose, no explanation, no markdown, no code fences.`;

/** Verbatim clean: a legible string stays as-is; empty/whitespace/non-string → null. */
function clean(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

/**
 * Turn the vision model's text into a {@link CardScanResult}, enforcing the trust
 * rules regardless of what the model returned:
 *  - unparseable / not an object → treated as a non-card (nothing is fabricated);
 *  - is_card not strictly true → non-card;
 *  - every field is either a legible string or null (never a guess).
 */
export function parseCardScan(modelText: string): CardScanResult {
  const obj = extractJsonObject(modelText);
  if (!obj || typeof obj !== 'object') return { isCard: false, contact: null };
  const rec = obj as Record<string, unknown>;
  if (rec.is_card !== true) return { isCard: false, contact: null };
  return {
    isCard: true,
    contact: {
      name: clean(rec.name),
      title: clean(rec.title),
      phone: clean(rec.phone),
      email: clean(rec.email),
    },
  };
}
