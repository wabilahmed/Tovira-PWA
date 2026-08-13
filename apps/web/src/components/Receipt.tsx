import { formatStamp } from '../format/dates.js';

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

  const body = (
    <>
      <div style={{ color: 'var(--text-primary)' }}>“{quote}”</div>
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
