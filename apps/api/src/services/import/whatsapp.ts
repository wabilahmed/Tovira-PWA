/**
 * WhatsApp "Export Chat" (.txt) parser (P1-4b).
 *
 * Turns an export into ordered, speaker-attributed messages. Pure function — no
 * DB, no clock — so it is fully unit-testable and deterministic. The caller
 * persists the raw file first, then stores these messages only if parsing wholly
 * succeeds (never a half-import).
 *
 * Supported line shape (WhatsApp iOS/Android "Export Chat"):
 *   [YYYY-MM-DD, HH:MM(:SS)? (AM|PM)?] Sender Name: message body
 *   YYYY-MM-DD, HH:MM(:SS)? (AM|PM)? - Sender Name: message body   (bare/Android)
 * A line that matches no header is a continuation of the previous message.
 */

export interface ParsedMessage {
  /** Local wall-clock ISO 'YYYY-MM-DDTHH:MM[:SS]', or null if unparseable. */
  sentAt: string | null;
  sender: string;
  body: string;
  /** True when the message was a media placeholder (<Media omitted>, etc.). */
  media: boolean;
  /** Speaker role, resolved after parsing (P1-6). Parser emits 'unknown'. */
  role: 'client' | 'rep' | 'unknown';
}

export type WhatsAppParseResult =
  | { ok: true; messages: ParsedMessage[] }
  | { ok: false; reason: string };

// Control characters WhatsApp sprinkles in (LTR mark, narrow no-break space).
const CONTROL_CHARS = /[\u200e\u200f\u202f\u00a0\u2007\u2060\ufeff]/g;

// A message header, either bracketed ([ts] Sender: body) or bare (ts - Sender: body).
const HEADER_RE =
  /^(?:\[(?<bracketed>[^\]]+)\]\s*|(?<bare>\d{1,4}[/-]\d{1,2}[/-]\d{1,4},?\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AaPp][Mm])?)\s*-\s*)(?<sender>[^:]+?):\s?(?<body>.*)$/;

const MEDIA_RE = /(?:<\s*media\s+omitted\s*>|\bimage omitted\b|\bvideo omitted\b|<\s*attached:)/i;

/** Normalise a WhatsApp timestamp to 'YYYY-MM-DDTHH:MM[:SS]', or null. */
function normaliseTimestamp(raw: string): string | null {
  const s = raw.replace(CONTROL_CHARS, '').trim();
  // ISO-style date: 2026-01-15, 14:30(:45)? optionally with AM/PM.
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?$/);
  if (!m) return null;
  const [, y, mo, d, hhRaw, mm, ss, ampm] = m;
  let hh = Number(hhRaw);
  if (ampm) {
    const pm = /p/i.test(ampm);
    if (hh === 12) hh = pm ? 12 : 0;
    else if (pm) hh += 12;
  }
  const hhStr = String(hh).padStart(2, '0');
  return `${y}-${mo}-${d}T${hhStr}:${mm}${ss ? `:${ss}` : ':00'}`;
}

export function parseWhatsAppExport(text: string): WhatsAppParseResult {
  if (typeof text !== 'string' || text.trim() === '') {
    return { ok: false, reason: 'Empty upload — nothing to import.' };
  }

  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const messages: ParsedMessage[] = [];

  for (const rawLine of lines) {
    const line = rawLine.replace(CONTROL_CHARS, '');
    const m = line.match(HEADER_RE);
    if (m?.groups) {
      const tsRaw = (m.groups.bracketed ?? m.groups.bare ?? '').trim();
      const body = m.groups.body ?? '';
      messages.push({
        sentAt: normaliseTimestamp(tsRaw),
        sender: (m.groups.sender ?? '').trim(),
        body,
        media: MEDIA_RE.test(body),
        role: 'unknown',
      });
    } else if (messages.length > 0) {
      // Continuation of the previous message (multi-line body).
      const prev = messages[messages.length - 1]!;
      prev.body = prev.body === '' ? line : `${prev.body}\n${line}`;
      if (MEDIA_RE.test(line)) prev.media = true;
    }
    // A non-header line before any message is export preamble — ignored.
  }

  if (messages.length === 0) {
    return {
      ok: false,
      reason: "This doesn't look like a WhatsApp export. Use WhatsApp's Export Chat (.txt).",
    };
  }
  return { ok: true, messages };
}
