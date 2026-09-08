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

// A DATED line with NO "Sender:" — a WhatsApp system notice (the end-to-end-encryption line,
// "you changed…", etc.). Same timestamp prefix as HEADER_RE but no sender colon. These must be
// SKIPPED, never folded into the preceding message as a continuation (that would corrupt it).
const SYSTEM_PREFIX_RE =
  /^(?:\[[^\]]+\]\s*|\d{1,4}[/-]\d{1,2}[/-]\d{1,4},?\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AaPp][Mm])?\s*-\s*)/;

const MEDIA_RE = /(?:<\s*media\s+omitted\s*>|\bimage omitted\b|\bvideo omitted\b|<\s*attached:)/i;

/** Parse the DATE part of a timestamp to {y, mo, d}. Accepts ISO (YYYY-MM-DD) and the real WhatsApp
 *  slash/dash forms, which are DAY-FIRST (DD/MM/YYYY — UAE/most locales; the sample export is
 *  day-first) with a 2- or 4-digit year. Month-first (US) is not auto-detected; the YEAR is
 *  unambiguous either way, which is what the reference-date resolution depends on. */
function parseDatePart(d: string): { y: number; mo: number; d: number } | null {
  let m = d.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/); // ISO first (bracketed iOS exports)
  if (m) return { y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]) };
  m = d.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/); // day-first DD/MM/YY(YY)
  if (m) {
    let yr = Number(m[3]);
    if (yr < 100) yr += 2000;
    return { y: yr, mo: Number(m[2]), d: Number(m[1]) };
  }
  return null;
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** Normalise a WhatsApp timestamp to 'YYYY-MM-DDTHH:MM[:SS]', or null. Handles both the bracketed
 *  iOS ISO form and the bare Android day-first form, 12h (am/pm) and 24h. */
function normaliseTimestamp(raw: string): string | null {
  const s = raw.replace(CONTROL_CHARS, '').trim();
  const m = s.match(/^(.+?),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?$/);
  if (!m) return null;
  const [, dateStr, hhRaw, mm, ss, ampm] = m;
  const date = parseDatePart(dateStr!.trim());
  if (!date || date.mo < 1 || date.mo > 12 || date.d < 1 || date.d > 31) return null;
  let hh = Number(hhRaw);
  if (ampm) {
    const pm = /p/i.test(ampm);
    if (hh === 12) hh = pm ? 12 : 0;
    else if (pm) hh += 12;
  }
  return `${date.y}-${pad(date.mo)}-${pad(date.d)}T${pad(hh)}:${mm}${ss ? `:${ss}` : ':00'}`;
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
    } else if (SYSTEM_PREFIX_RE.test(line)) {
      // A dated line with no "Sender:" is a system notice (E2E-encryption line, "you changed…").
      // Skip it entirely — it is neither a participant message nor a continuation of one.
      continue;
    } else if (messages.length > 0) {
      // Continuation of the previous message (multi-line body).
      const prev = messages[messages.length - 1]!;
      prev.body = prev.body === '' ? line : `${prev.body}\n${line}`;
      if (MEDIA_RE.test(line)) prev.media = true;
    }
    // A non-header, non-system line before any message is export preamble — ignored.
  }

  if (messages.length === 0) {
    return {
      ok: false,
      reason: "This doesn't look like a WhatsApp export. Use WhatsApp's Export Chat (.txt).",
    };
  }
  return { ok: true, messages };
}
