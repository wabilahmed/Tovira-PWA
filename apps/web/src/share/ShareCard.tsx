import { useEffect, useState } from 'react';
import type { ShareCardStats } from './shareCardClient.js';

export interface ShareCardApi {
  get(): Promise<ShareCardStats | null>;
}

/**
 * Shareable Book Scan card + referral (P5-6). STATS ONLY — the numbers come from
 * a counts-only endpoint, so there is nothing client-identifying to leak. Give a
 * month / get a month via the referral link.
 */
export function ShareCard({
  api,
  referralCode,
  origin = typeof window !== 'undefined' ? window.location.origin : '',
  onShare = (url) => { void navigator.clipboard?.writeText(url); },
}: {
  api: ShareCardApi;
  referralCode?: string;
  origin?: string;
  onShare?: (url: string) => void;
}): JSX.Element | null {
  const [card, setCard] = useState<ShareCardStats | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [shared, setShared] = useState(false);

  useEffect(() => {
    let live = true;
    void api.get().then((c) => { if (live) { setCard(c); setLoaded(true); } });
    return () => { live = false; };
  }, [api]);

  if (!loaded) return <p>Building your share card…</p>;
  if (!card || card.total === 0) return null;

  const referralUrl = referralCode ? `${origin}/?ref=${referralCode}` : '';
  const rows: Array<[string, number]> = [
    ['open promises', card.openPromises],
    ['unanswered questions', card.unansweredQuestions],
    ['clients going quiet', card.goingCold],
    ['upcoming dates', card.upcomingDates],
  ];

  // A redacted register clipping (§10): counts only, set like a statement excerpt
  // under a brass rule — never a social badge. (Counts-only per the P5-6 tests.)
  return (
    <section aria-label="Share card" className="tov-statement" style={box}>
      <div className="tov-stamp" style={{ marginBottom: 10 }}>Book Scan · statement excerpt</div>
      <ul data-testid="share-stats" style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.4rem' }}>
        {rows.filter(([, n]) => n > 0).map(([label, n]) => (
          <li key={label} style={{ display: 'flex', gap: '0.75rem', alignItems: 'baseline', borderBottom: '1px solid var(--hairline)', paddingBottom: '0.35rem' }}>
            <span className="tov-mono" style={{ color: 'var(--brass)', minWidth: '2ch', textAlign: 'end' }}>{n}</span> {label}
          </li>
        ))}
      </ul>
      {referralCode && (
        <div style={{ marginTop: '0.75rem' }}>
          <p style={{ margin: '0 0 0.35rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Share Tovira — you both get a free month.</p>
          <code data-testid="referral-link" className="tov-mono" style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{referralUrl}</code>{' '}
          <button onClick={() => { onShare(referralUrl); setShared(true); }}>{shared ? 'Copied ✓' : 'Copy link'}</button>
        </div>
      )}
    </section>
  );
}

const box: React.CSSProperties = { border: '1px solid var(--hairline)', borderRadius: 'var(--radius-card)', padding: '1rem 1.25rem', background: 'var(--surface-raised)', margin: '1rem 0' };
