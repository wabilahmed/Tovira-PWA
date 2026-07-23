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
        <p style={{ color: '#666' }}>{report.message}</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: '0.75rem' }}>
          {report.items.map((item, i) => (
            <li key={i} data-testid="scan-item" style={card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem' }}>
                <strong>{item.headline}</strong>
                {item.framing === 'worth_checking' && <span style={badge}>worth checking</span>}
              </div>
              <small style={{ color: '#888' }}>
                {KIND_LABEL[item.kind]} · {item.clientName}
              </small>
              <blockquote data-testid="receipt" style={receipt}>
                “{item.receipt.quote}”{item.receipt.date ? <span style={{ color: '#888' }}> — {item.receipt.date}</span> : null}
              </blockquote>
            </li>
          ))}
        </ul>
      )}

      <p style={{ marginTop: '1.5rem', color: '#2563eb' }}>{report.invitation}</p>
    </section>
  );
}

const card: React.CSSProperties = {
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  padding: '0.75rem 1rem',
  background: '#fff',
};
const badge: React.CSSProperties = {
  fontSize: '0.7rem',
  background: '#fef3c7',
  color: '#92400e',
  borderRadius: 999,
  padding: '0.1rem 0.5rem',
  whiteSpace: 'nowrap',
  alignSelf: 'center',
};
const receipt: React.CSSProperties = {
  margin: '0.5rem 0 0',
  paddingLeft: '0.75rem',
  borderLeft: '3px solid #e5e7eb',
  color: '#333',
};
