/**
 * [P69-14 · owner] Pregnancy is health data, whatever category the extraction puts it in.
 *
 * Pregnancy, "expecting", a baby on the way, maternity/paternity plans, fertility and IVF are health data. Tovira never
 * stores health data, but the extraction can file this as "family" (the Recruitment card check stored
 * "Expecting a baby" 5 out of 5 times). The category health filter can't catch that, because the label isn't
 * "health". This is the deterministic store-time block. It runs at the ONE point where every capture path (voice,
 * paste, chat import, windowed import, WhatsApp, held Ask-captures) stores its extraction, and on the pointer set
 * stored after it.
 *
 * DOCTRINE (owner): Tovira may remove words for safety, never add or change them.
 *   - Cut only. A clause that mentions pregnancy is removed; a timing qualifier ("after the baby") is removed on its
 *     own, so "Hybrid arrangement after the baby" keeps "Hybrid arrangement". No word is ever added, reworded or
 *     reordered. After a cut, only dangling punctuation and spacing are tidied.
 *   - If a cut leaves nothing meaningful ("Expecting a baby"), the whole item is dropped.
 *   - A receipt quote is blanked with the redaction marker in place of the clause, never dropped, so the fact keeps
 *     its receipt. The marker is the only text ever inserted, and only into a quote.
 *   - Applies to personal facts, asks (requirements), key dates, worries (concerns), people's roles, pointers, and
 *     every receipt quote.
 *   - [P69-17 · owner] Promise text is BLANKED, not cut: the pregnancy clause becomes the marker, so the commitment is
 *     never shortened into a different one ("Send flowers when the baby arrives" → "Send flowers [health detail
 *     redacted]") and a promise is never dropped. Next steps and the summary are left as they are.
 *   - [P69-17 · owner] A key date that is just "Due date" (optionally "her/the baby's due date") on a personal date is a
 *     pregnancy due date and is dropped. A deadline or launch date, or "Payment due date", is left alone.
 *
 * Deliberately OUTSIDE the certified surfaces: this file is not in CERT_SURFACE or NARROW_SURFACE, and the gate does
 * not import it. It only removes stored content after the certified extraction has run, so what the gate scores is
 * unchanged and nothing it certifies is weakened.
 */

export const HEALTH_MARKER = '[health detail redacted]';

// A timing qualifier around a baby: cut just this phrase (with a comma that introduces it).
const QUALIFIER = new RegExp(
  String.raw`(?:,\s*)?\b(?:after|before|once|when|until|till|ahead\s+of|around|during)\s+` +
    String.raw`(?:(?:(?:the|her|his|their|our|my|a)\s+(?:new\s+)?baby(?:\s+(?:arrives|comes|is\s+born|is\s+here|has\s+arrived))?)` +
    String.raw`|(?:having\s+(?:the|her|his|their|our|my|a)\s+baby)` +
    String.raw`|(?:(?:she|he|they|we|i)\s+(?:has|have|had)\s+(?:the|a|her|their|our)\s+baby)` +
    String.raw`|(?:(?:her|his|their|my|our|the)\s+)?(?:maternity|paternity)\s+leave)\b`,
  'gi',
);

const MONTH = 'january|february|march|april|may|june|july|august|september|october|november|december|spring|summer|autumn|fall|winter';
// A term that makes the whole clause health data.
const TERM = new RegExp(
  [
    String.raw`\bpregnan\w*`,
    String.raw`\bexpecting\s+(?:(?:a|their|her|his|our|my|another)\s+)?(?:(?:first|second|third|fourth|new)\s+)?(?:baby|child|little\s+one|twins|triplets)\b`,
    String.raw`\bexpecting\b(?=\s*(?:[.;,!?)]|$|\s+(?:in|this|next|around|by)\s+(?:${MONTH}|the\s+new\s+year)\b))`,
    String.raw`\bbaby\s+(?:is\s+)?(?:on\s+the\s+way|due)\b`,
    String.raw`\bhaving\s+(?:a|another|the|their|her|his|our|my)\s+baby\b`,
    String.raw`\b(?:going|about)\s+to\s+have\s+(?:a|another)\s+baby\b`,
    String.raw`\b(?:maternity|paternity)\b`,
    String.raw`\bfertility\b`,
    String.raw`\binfertil\w*`,
    String.raw`\bivf\b`,
    String.raw`\bin[\s-]vitro\b`,
    String.raw`\btrying\s+(?:for\s+(?:a\s+)?(?:baby|child|kids?)|to\s+conceive)\b`,
    String.raw`\bmiscarr\w*`,
  ].join('|'),
  'i',
);

/** True when the text mentions pregnancy (a clause term or a timing qualifier). */
export function mentionsPregnancy(text: unknown): boolean {
  if (typeof text !== 'string' || !text) return false;
  QUALIFIER.lastIndex = 0;
  const q = QUALIFIER.test(text);
  QUALIFIER.lastIndex = 0;
  return q || TERM.test(text);
}

// A clause ends at sentence punctuation, a semicolon, a comma, a dash or a line break; the delimiter stays with the
// clause it ends, so removing a clause removes its own delimiter.
const CLAUSE = /(?:[^.;,!?\n–—\s-]|-(?!\s)|(?<!\s)-|[ \t\r](?!-\s))+|[.;,!?\n–—]+|\s-\s/g;
const CONNECTOR = /(\s+(?:and|but|so)\s+)/i;

const STOP = new Set(('and but so or the a an after before once when until till with will would is are was were be been being she he they we ' +
  'it to of in on for at her his their our my has have had wants want also its this that then just very').split(' '));

/** Something meaningful survives: a word of three or more letters that isn't a filler word. */
export function isMeaningful(text: string): boolean {
  return (text.toLowerCase().match(/\p{L}{3,}/gu) ?? []).some((w) => !STOP.has(w));
}

function tidy(s: string): string {
  return s
    .replace(/\s+/g, ' ')
    .replace(/\s+([.;,!?:])/g, '$1')
    .replace(/([;,:])(?:\s*[;,:])+/g, '$1')
    .replace(/^[\s.;,:!?\-–—]+/, '')
    .replace(/[\s;,:\-–—]+$/, '')
    .trim();
}

/** Cut (or, for a quote, blank) every pregnancy clause and qualifier. `replacement` '' cuts; the marker blanks. */
function remove(text: string, replacement: string): string {
  const mark = (s: string): string => (replacement ? s.replace(/^(\s*)[\s\S]*?(\s*)$/, `$1${replacement}$2`) : '');
  let out = text.replace(QUALIFIER, (m) => (replacement ? (m.startsWith(',') ? `, ${replacement}` : replacement) : ''));
  if (TERM.test(out)) {
    const parts = out.match(CLAUSE) ?? [out];
    out = parts
      .map((part) => {
        if (!TERM.test(part)) return part;
        // Within the clause, keep a sub-clause joined by and/but/so that doesn't mention it. Pieces alternate
        // text, connector, text…; a dropped piece takes its own connector with it, the rest keep theirs verbatim.
        const pieces = part.split(CONNECTOR);
        let res = '';
        let kept = 0;
        for (let i = 0; i < pieces.length; i += 2) {
          const piece = pieces[i]!;
          const bad = TERM.test(piece);
          if (bad && !replacement) continue;
          res += (kept > 0 ? pieces[i - 1] ?? ' ' : i > 0 ? ' ' : '') + (bad ? mark(piece) : piece);
          kept += 1;
        }
        return res;
      })
      .join('');
  }
  if (replacement) {
    const esc = replacement.replace(/[[\]]/g, '\\$&');
    out = out.replace(new RegExp(`${esc}(?:[\\s,;]*${esc})+`, 'g'), replacement);
    return out.replace(/[ \t]+/g, ' ').trim();
  }
  return tidy(out);
}

/** Cut the pregnancy parts out of a text. Returns null when nothing meaningful is left (drop the item). */
export function cutText(text: string): string | null {
  if (!mentionsPregnancy(text)) return text;
  const out = remove(text, '');
  return isMeaningful(out) ? out : null;
}

/** Blank the pregnancy parts of a receipt quote with the marker. A quote is never dropped. */
export function blankQuote(quote: string): string {
  return mentionsPregnancy(quote) ? remove(quote, HEALTH_MARKER) : quote;
}

export interface PregnancyCutCounts { dropped: number; cut: number; quotesBlanked: number; promisesBlanked: number }

const DUE_DATE = /^\s*(?:(?:the|her|his|their|our|my)\s+)?(?:baby'?s?\s+)?due\s+date\s*$/i;
const BUSINESS_DATE_TYPES = new Set(['deadline', 'launch']);
/** A bare "Due date" on a personal key date: a pregnancy due date. */
export function isPregnancyDueDate(description: unknown, type: unknown): boolean {
  return typeof description === 'string' && DUE_DATE.test(description) && !(typeof type === 'string' && BUSINESS_DATE_TYPES.has(type.trim().toLowerCase()));
}

type Spanned = { source_span?: string | null };
type Ex = {
  personal_facts?: Array<{ subject?: string | null; fact?: string } & Spanned>;
  key_dates?: Array<{ description?: string; date_raw?: string | null; type?: string } & Spanned>;
  requirements?: Array<{ text?: string; requirement_raw?: string }>;
  concerns?: unknown[];
  people?: Array<{ name?: string | null; role?: string | null } & Spanned>;
  promises?: Array<{ text?: string } & Spanned>;
  meeting?: Spanned | null;
};

/**
 * Apply the block to an extraction, in place. Facts, asks, key dates and worries are cut (dropped when nothing
 * meaningful is left); every receipt quote is blanked. Returns counts only, never content.
 */
export function cutPregnancy(ex: Ex): PregnancyCutCounts {
  const c: PregnancyCutCounts = { dropped: 0, cut: 0, quotesBlanked: 0, promisesBlanked: 0 };
  const quote = (h: Spanned | null | undefined): void => {
    if (h && typeof h.source_span === 'string' && mentionsPregnancy(h.source_span)) { h.source_span = blankQuote(h.source_span); c.quotesBlanked += 1; }
  };
  /** Cut one text field; false = drop the item. */
  const field = <T extends object>(item: T, key: keyof T): boolean => {
    const v = item[key];
    if (typeof v !== 'string' || !mentionsPregnancy(v)) return true;
    const next = cutText(v);
    if (next === null) return false;
    (item as Record<keyof T, unknown>)[key] = next;
    c.cut += 1;
    return true;
  };
  const keep = <T>(arr: T[] | undefined, ok: (x: T) => boolean): T[] | undefined => {
    if (!Array.isArray(arr)) return arr;
    const kept = arr.filter(ok);
    c.dropped += arr.length - kept.length;
    return kept;
  };

  ex.personal_facts = keep(ex.personal_facts, (f) => {
    if (mentionsPregnancy(f.subject)) return false;
    if (!field(f, 'fact')) return false;
    quote(f);
    return true;
  });
  ex.key_dates = keep(ex.key_dates, (d) => {
    if (isPregnancyDueDate(d.description, d.type)) return false;
    if (!field(d, 'description')) return false;
    if (typeof d.date_raw === 'string' && mentionsPregnancy(d.date_raw)) { d.date_raw = blankQuote(d.date_raw); c.quotesBlanked += 1; }
    quote(d);
    return true;
  });
  ex.requirements = keep(ex.requirements, (r) => {
    if (!field(r, 'text')) return false;
    // requirement_raw is the client's own words: the ask's receipt, so it is blanked, not cut.
    if (typeof r.requirement_raw === 'string' && mentionsPregnancy(r.requirement_raw)) { r.requirement_raw = blankQuote(r.requirement_raw); c.quotesBlanked += 1; }
    return true;
  });
  if (Array.isArray(ex.concerns)) {
    const before = ex.concerns.length;
    ex.concerns = ex.concerns.flatMap((s) => {
      if (typeof s !== 'string' || !mentionsPregnancy(s)) return [s];
      const next = cutText(s);
      if (next === null) return [];
      c.cut += 1;
      return [next];
    });
    c.dropped += before - ex.concerns.length;
  }
  for (const p of ex.people ?? []) {
    if (typeof p.role === 'string' && mentionsPregnancy(p.role)) { const r = cutText(p.role); p.role = r; c.cut += 1; }
    quote(p);
  }
  for (const p of ex.promises ?? []) {
    if (typeof p.text === 'string' && mentionsPregnancy(p.text)) { p.text = blankQuote(p.text); c.promisesBlanked += 1; }
    quote(p);
  }
  quote(ex.meeting);
  return c;
}

/** The pointer set: a pointer is cut like a fact (dropped when nothing meaningful is left); its quotes are blanked. */
export function cutPregnancyPointers<P extends { text: string; receipts: Array<{ source_span: string }> }>(pointers: P[]): { pointers: P[]; counts: PregnancyCutCounts } {
  const counts: PregnancyCutCounts = { dropped: 0, cut: 0, quotesBlanked: 0, promisesBlanked: 0 };
  const out: P[] = [];
  for (const p of pointers) {
    const text = cutText(p.text);
    if (text === null) { counts.dropped += 1; continue; }
    if (text !== p.text) counts.cut += 1;
    const receipts = p.receipts.map((r) => {
      if (!mentionsPregnancy(r.source_span)) return r;
      counts.quotesBlanked += 1;
      return { ...r, source_span: blankQuote(r.source_span) };
    });
    out.push({ ...p, text, receipts });
  }
  return { pointers: out, counts };
}
