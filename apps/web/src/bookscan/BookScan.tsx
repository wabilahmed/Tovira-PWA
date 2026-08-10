import { useEffect, useState } from 'react';
import type { BookScanReport, BookScanItem } from './bookScanClient.js';

export interface BookScanApi {
  scan(): Promise<BookScanReport | null>;
}

const KIND_LABEL: Record<BookScanItem['kind'], string> = {
  open_promise: 'Open promise',
  unanswered_question: 'Unanswered question',
  going_cold: 'Going quiet',
  upcoming_date: 'Upcoming date',
};

/**
 * The Day-One Book Scan / "Relationship X-Ray" (P5-3b). Renders every finding
 * with its receipt (quote + date) — the trust rule that lets it fire day one.
 */
export function BookScan({ api }: { api: BookScanApi }): JSX.Element {
  const [report, setReport] = useState<BookScanReport | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let live = true;
    void api.scan().then((r) => {
      if (!live) return;
      if (r) {
        setReport(r);
        setState('ready');
      } else {
        setState('error');
      }
    });
    return () => {
      live = false;
    };
  }, [api]);

  if (state === 'loading') return <p>Scanning your history…</p>;
  if (state === 'error' || !report) return <p role="alert">Couldn’t run the scan. Please try again.</p>;

  return (
    <section aria-label="Book Scan">
      <h2 style={{ marginTop: 0 }}>Your Relationship X-Ray</h2>

      {report.isEmpty ? (
        <p style={{ color: 'var(--text-secondary)' }}>{report.message}</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: '0.75rem' }}>
          {report.items.map((item, i) => (
            // The one orchestrated moment: findings deal out like an audit
            // delivered across a desk (§4). Staggered; reduced-motion respected.
            <li key={i} data-testid="scan-item" className="tov-card tov-deal" style={{ animationDelay: `${i * 60}ms` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem' }}>
                <strong>{item.headline}</strong>
                {item.framing === 'worth_checking' && <span style={badge}>worth checking</span>}
              </div>
              <div data-testid="receipt" className="tov-receipt">
                <div style={{ color: 'var(--text-primary)' }}>“{item.receipt.quote}”</div>
                <div className="tov-stamp" style={{ marginTop: 6 }}>
                  {KIND_LABEL[item.kind]} · {item.clientName}
                  {item.receipt.date ? <> · {item.receipt.date}</> : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p style={{ marginTop: '1.5rem', color: 'var(--brass)' }}>{report.invitation}</p>
    </section>
  );
}

const badge: React.CSSProperties = {
  fontSize: '0.7rem',
  background: 'var(--amber-surface)',
  color: 'var(--amber)',
  borderRadius: 999,
  padding: '0.1rem 0.5rem',
  whiteSpace: 'nowrap',
  alignSelf: 'center',
};
