import { formatStamp } from '../format/dates.js';

/** Predominant script of a quote — Arabic if it outweighs the Latin letters. A
 *  fully-Arabic quote renders RTL; an English quote with an inline Arabic phrase
 *  stays LTR (the Arabic glyphs fall back to the companion font in var(--font-sans)). */
function isArabicQuote(s: string): boolean {
  const ar = (s.match(/[؀-ۿ]/g) ?? []).length;
  const la = (s.match(/[A-Za-z]/g) ?? []).length;
  return ar > la;
}

/**
 * The Receipt-chit (docs/tovira-brand.md §5) — the brand's visual signature.
 * A perforated slip with a brass left tick: the quote in body sans, and a mono
 * stamp line `SOURCE · DD MON YYYY`. Used everywhere a quote+date backs a claim
 * (Book Scan, recall answers, briefs). Do NOT restyle per feature — one chit.
 *
 * When `onOpen` is given the whole chit is a button that opens the source
 * message in the client timeline (§5). Without it, the chit is inert.
 */
export function Receipt({
  quote,
  source,
  date,
  onOpen,
}: {
  quote: string;
  source?: string | null;
  date?: string | null;
  onOpen?: () => void;
}): JSX.Element {
  const stampDate = date ? formatStamp(date) : '';
  const stamp = [source || null, stampDate || null].filter(Boolean).join(' · ');

  // Arabic quotes read RTL in Arabic guillemets « »; Latin quotes use “ ” and
  // dir="auto" so an inline Arabic phrase still lays out correctly (§3 bidi rule).
  const rtl = isArabicQuote(quote);
  const openQ = rtl ? '«' : '“';
  const closeQ = rtl ? '»' : '”';

  const body = (
    <>
      <div
        dir={rtl ? 'rtl' : 'auto'}
        lang={rtl ? 'ar' : undefined}
        className={rtl ? 'tov-receipt__rtl' : undefined}
        style={{ color: 'var(--text-primary)' }}
      >
        {openQ}{quote}{closeQ}
      </div>
      {/* The mono stamp stays LTR and left-aligned — the register reads the same down the column. */}
      {stamp && <div className="tov-stamp" style={{ marginTop: 6 }}>{stamp}</div>}
    </>
  );

  if (onOpen) {
    return (
      <button type="button" data-testid="receipt" className="tov-receipt tov-receipt--tap" onClick={onOpen} aria-label={`Open source: ${quote}`}>
        {body}
      </button>
    );
  }
  return (
    <div data-testid="receipt" className="tov-receipt">
      {body}
    </div>
  );
}
