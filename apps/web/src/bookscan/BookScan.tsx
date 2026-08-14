import { useEffect, useState } from 'react';
import type { BookScanReport, BookScanItem, BookScanKind } from './bookScanClient.js';
import { Receipt } from '../components/Receipt.js';
import { daysSince } from '../format/dates.js';

export interface BookScanApi {
  scan(): Promise<BookScanReport | null>;
}

/** Section label + display order for each finding kind (board §6 grouping). */
const SECTIONS: Array<{ kind: BookScanKind; label: string }> = [
  { kind: 'open_promise', label: 'Open promises' },
  { kind: 'unanswered_question', label: 'Unanswered questions' },
  { kind: 'going_cold', label: 'Going quiet' },
  { kind: 'upcoming_date', label: 'Dates ahead' },
];

/**
 * The Day-One Book Scan (P5-3b) — "the audit". A Fraunces headline over a mono
 * meta line, findings grouped into ruled sections (mono stamp + count), each
 * finding backed by a Receipt-chit, and the one orchestrated deal-out reveal.
 */
export function BookScan({ api, now = Date.now() }: { api: BookScanApi; now?: number }): JSX.Element {
  const [report, setReport] = useState<BookScanReport | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let live = true;
    void api.scan().then((r) => {
      if (!live) return;
      if (r) { setReport(r); setState('ready'); } else setState('error');
    });
    return () => { live = false; };
  }, [api]);

  if (state === 'loading') return <p>Scanning your history…</p>;
  if (state === 'error' || !report) return <p role="alert">Couldn’t run the scan. Please try again.</p>;

  if (report.isEmpty) {
    return (
      <section aria-label="Book Scan">
        <header className="tov-screenhead">
          <div className="tov-stamp">The Book Scan</div>
          <h2>What your book has been hiding</h2>
        </header>
        <p style={{ color: 'var(--text-secondary)' }}>{report.message}</p>
        <p style={{ marginTop: '1.5rem', color: 'var(--brass)' }}>{report.invitation}</p>
      </section>
    );
  }

  const clients = new Set(report.items.map((i) => i.clientId)).size;
  let dealt = 0; // running index so findings deal out in order across sections

  return (
    <section aria-label="Book Scan">
      <header className="tov-screenhead">
        <div className="tov-stamp">The Book Scan</div>
        <h2>What your book has been hiding</h2>
        <div className="tov-screenmeta">
          {report.items.length} finding{report.items.length === 1 ? '' : 's'} · {clients} client{clients === 1 ? '' : 's'}
          {typeof report.chatsRead === 'number' && <> · {report.chatsRead} chat{report.chatsRead === 1 ? '' : 's'} read</>}
        </div>
      </header>

      {SECTIONS.map(({ kind, label }) => {
        const group = report.items.filter((i) => i.kind === kind);
        if (group.length === 0) return null;
        return (
          <div key={kind} style={{ margin: '1.25rem 0' }}>
            <div className="tov-stamp" style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', marginBottom: 8 }}>
              <span>{label}</span>
              <span>{String(group.length).padStart(2, '0')}</span>
            </div>
            {group.map((item) => {
              const i = dealt++;
              return <Finding key={`${item.clientId}-${i}`} item={item} index={i} now={now} />;
            })}
          </div>
        );
      })}

      <p style={{ marginTop: '1.5rem', color: 'var(--brass)' }}>{report.invitation}</p>
    </section>
  );
}

function Finding({ item, index, now }: { item: BookScanItem; index: number; now: number }): JSX.Element {
  const silent = item.kind === 'going_cold' && item.receipt.date ? daysSince(Date.parse(item.receipt.date), now) : null;
  return (
    <div data-testid="scan-item" className="tov-deal" style={{ animationDelay: `${index * 60}ms`, margin: '0 0 0.85rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', alignItems: 'baseline' }}>
        <strong>{item.headline}</strong>
        {item.framing === 'worth_checking' && <span style={chip}>worth checking</span>}
      </div>
      {silent !== null && (
        <div className="tov-stamp" style={{ color: 'var(--claret)', marginTop: 2 }}>silent {silent} day{silent === 1 ? '' : 's'}</div>
      )}
      <Receipt quote={item.receipt.quote} source={item.clientName} date={item.receipt.date} />
    </div>
  );
}

const chip: React.CSSProperties = {
  fontSize: '0.7rem',
  background: 'var(--amber-surface)',
  color: 'var(--amber)',
  borderRadius: 999,
  padding: '0.1rem 0.5rem',
  whiteSpace: 'nowrap',
  alignSelf: 'center',
};
