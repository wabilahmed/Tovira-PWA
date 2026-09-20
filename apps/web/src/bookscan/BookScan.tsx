import { useEffect, useRef, useState } from 'react';
import type { BookScanReport, BookScanItem } from './bookScanClient.js';
import { Receipt } from '../components/Receipt.js';
import { daysSince } from '../format/dates.js';
import { findingId, appendFindings } from './streaming.js';

export interface BookScanApi {
  scan(): Promise<BookScanReport | null>;
}

/** [BOOKSCAN-STREAM] Poll cadence while the scan is still analysing chats. 4s matches the notes-timeline
 *  poll from the async batch (one consistent cadence): fast enough that a dropped promise appears within
 *  a few seconds, slow enough not to hammer the server or the phone battery. Polling STOPS on done. */
const POLL_MS = 4000;

/**
 * The Day-One Book Scan (P5-3b) — "the audit". [BOOKSCAN-STREAM] It STREAMS: findings append in arrival
 * order as chats extract (never re-sorted — the server groups by category, so stability is enforced
 * client-side via appendFindings + findingId), with an always-visible progress signal so a partial scan
 * is never mistaken for a finished one.
 */
export function BookScan({ api, now = Date.now() }: { api: BookScanApi; now?: number }): JSX.Element {
  const [report, setReport] = useState<BookScanReport | null>(null);
  const [shown, setShown] = useState<BookScanItem[]>([]); // append-only, arrival order — never re-sorted
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  // Poll until the scan is finished (done), then stop — a scan that polls forever is a battery + cost
  // problem. Re-runs on remount (fresh api), so returning to the screen shows current state, not stale.
  useEffect(() => {
    let live = true;
    const timer = { id: null as ReturnType<typeof setInterval> | null };
    const stop = (): void => { if (timer.id) { clearInterval(timer.id); timer.id = null; } };
    const tick = async (): Promise<void> => {
      const r = await api.scan();
      if (!live) return;
      if (!r) { setState((s) => (s === 'loading' ? 'error' : s)); return; }
      setReport(r);
      setState('ready');
      const stillWorking = r.scanProgress ? !r.scanProgress.done : false;
      if (!stillWorking) stop(); // finished (or a server with no progress info) → stop polling
    };
    void tick();
    timer.id = setInterval(() => { void tick(); }, POLL_MS);
    return () => { live = false; stop(); };
  }, [api]);

  // Accumulate append-only: keep every finding already shown in place, add new ones at the end.
  useEffect(() => {
    if (report) setShown((prev) => appendFindings(prev, report.items));
  }, [report]);

  if (state === 'loading') return <p>Scanning your history…</p>;
  if (state === 'error' || !report) return <p role="alert">Couldn’t run the scan. Please try again.</p>;

  // [BOOKSCAN-STREAM] Still working iff a chat is queued/processing. The empty state is shown ONLY when
  // the scan is FINISHED with nothing found — mid-scan-zero must read as "still scanning", never "empty".
  const progress = report.scanProgress;
  const scanning = progress ? !progress.done : false;

  if (!scanning && shown.length === 0) {
    return (
      <section aria-label="Book Scan">
        <header className="tov-screenhead">
          <div className="tov-stamp">The Book Scan</div>
          <h2>What your book has been hiding</h2>
        </header>
        <p style={{ color: 'var(--text-secondary)' }}>{report.message}</p>
      </section>
    );
  }

  const clients = new Set(shown.map((i) => i.clientId)).size;

  return (
    <section aria-label="Book Scan">
      <header className="tov-screenhead">
        <div className="tov-stamp">The Book Scan</div>
        <h2>What your book has been hiding</h2>
        <div className="tov-screenmeta">
          {shown.length} finding{shown.length === 1 ? '' : 's'} · {clients} client{clients === 1 ? '' : 's'}
          {typeof report.chatsRead === 'number' && <> · {report.chatsRead} chat{report.chatsRead === 1 ? '' : 's'} read</>}
        </div>
        {/* [BOOKSCAN-STREAM] Progress that can't be mistaken for completion: while any chat is still
            being analysed, this is ALWAYS shown, so three findings never read as "the total". */}
        {scanning && progress && (
          // [BOOKSCAN-STREAM · mobile] Sticky so the progress stays visible without scrolling as
          // findings stream in below it on a phone. Opaque background so pinned text stays legible.
          <div
            data-testid="scan-progress"
            role="status"
            aria-live="polite"
            className="tov-screenmeta"
            style={{ color: 'var(--amber)', position: 'sticky', top: 0, zIndex: 1, background: 'var(--surface-base)', padding: '0.4rem 0', borderBottom: '1px solid var(--hairline)' }}
          >
            Still scanning — analysed {progress.extractedChats} of {progress.totalChats} chat{progress.totalChats === 1 ? '' : 's'}
            {progress.failedChats > 0 && <> · {progress.failedChats} couldn’t be read</>}
          </div>
        )}
      </header>

      {/* Flat, arrival-ordered list — keyed by a stable derived id so React never reorders the DOM as
          new findings append. No section grouping: grouping would re-sort a late arrival into its
          category, moving already-read entries. */}
      <div style={{ margin: '1.25rem 0' }}>
        {shown.map((item, i) => (
          <Finding key={findingId(item)} item={item} index={i} now={now} />
        ))}
      </div>

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
