import { useState } from 'react';
import { ReceiptThread } from '../../receipts/ReceiptThread.js';
import { formatBody, formatDateTime } from '../../format/dates.js';
import type { ClientOverview, OverviewPromise } from './clientPageClient.js';

/**
 * [P36-5] The bodies and one-line summaries of the client page's sections — everything read from the overview
 * (stored record), every "where it came from" through the shared <ReceiptThread>.
 */

export function wantsSummary(o: ClientOverview | null): string | null {
  return o?.wants.summary ?? null;
}

export function WantsSection({ overview }: { overview: ClientOverview }): JSX.Element {
  const w = overview.wants;
  if (w.items.length === 0) return <p className="tov-muted">Nothing stated yet.</p>;
  return (
    <div style={{ display: 'grid', gap: '0.6rem' }}>
      {w.budgets.length > 1 && (
        <p style={{ margin: 0 }} data-testid="budget-history"><span className="tov-stamp">Budget</span> {w.budgets.join(' → ')}</p>
      )}
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.6rem' }}>
        {w.items.map((r) => (
          <li key={r.id}>
            <div dir="auto">{r.text}</div>
            <ReceiptThread refInfo={{ noteId: r.noteId, span: r.quote, quote: r.quote, at: r.statedOn }} />
          </li>
        ))}
      </ul>
    </div>
  );
}

export function promisesSummary(o: ClientOverview | null): string | null {
  if (!o || o.promises.length === 0) return null;
  const done = o.promises.filter((p) => p.done).length;
  if (o.openPromises === 0) return done > 0 ? `Nothing open · ${done} done` : null;
  return [`${o.openPromises} open`, o.overduePromises > 0 ? `${o.overduePromises} overdue` : null].filter(Boolean).join(' · ');
}

function whose(p: OverviewPromise, clientName: string): string {
  return p.owner === 'client' ? `${clientName} promised` : 'You promised';
}

function PromiseItem({ p, clientName, clientId }: { p: OverviewPromise; clientName: string; clientId: string }): JSX.Element {
  return (
    <li data-testid="client-promise" style={{ display: 'grid', gap: '0.25rem' }}>
      <div>
        <span className="tov-stamp" data-owner={p.owner === 'client' ? 'client' : 'rep'}>{whose(p, clientName)}</span>{' '}
        <span dir="auto">{p.text}</span>
        {p.dueDate && <span className={p.overdue ? 'tov-overdue' : 'tov-muted'}> · {p.overdue ? 'overdue since' : 'due'} {formatBody(p.dueDate)}</span>}
      </div>
      {p.receipt?.quote && (
        <ReceiptThread refInfo={{ noteId: p.noteId, clientId, span: p.sourceSpan ?? p.receipt.quote, at: p.sourceMessageAt ?? p.receipt.at, quote: p.receipt.quote, sender: p.receipt.source === 'capture' ? 'Your note' : null }} />
      )}
    </li>
  );
}

export function PromisesSection({ overview, clientName, clientId }: { overview: ClientOverview; clientName: string; clientId: string }): JSX.Element {
  const [showDone, setShowDone] = useState(false);
  const open = overview.promises.filter((p) => !p.done && !p.stale);
  const stale = overview.promises.filter((p) => !p.done && p.stale);
  const done = overview.promises.filter((p) => p.done);
  if (overview.promises.length === 0) return <p className="tov-muted">No promises on record.</p>;
  return (
    <div style={{ display: 'grid', gap: '0.6rem' }}>
      {open.length > 0 ? (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.75rem' }}>
          {[...open, ...stale].map((p) => <PromiseItem key={p.id} p={p} clientName={clientName} clientId={clientId} />)}
        </ul>
      ) : stale.length > 0 ? (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.75rem' }}>
          {stale.map((p) => <PromiseItem key={p.id} p={p} clientName={clientName} clientId={clientId} />)}
        </ul>
      ) : <p className="tov-muted">Nothing open.</p>}
      {done.length > 0 && (
        <div>
          <button type="button" className="tov-link" aria-expanded={showDone} onClick={() => setShowDone((s) => !s)}>
            {showDone ? 'Hide done' : `Show ${done.length} done`}
          </button>
          {showDone && (
            <ul style={{ listStyle: 'none', padding: 0, margin: '0.5rem 0 0', display: 'grid', gap: '0.75rem', opacity: 0.8 }}>
              {done.map((p) => <PromiseItem key={p.id} p={p} clientName={clientName} clientId={clientId} />)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export function meetingsSummary(o: ClientOverview | null, timeZone?: string): string | null {
  if (!o || o.meetingsCount === 0) return null;
  return o.nextMeeting ? `Next: ${formatDateTime(o.nextMeeting.datetime, timeZone)}` : 'Next: none booked';
}

export function MeetingsSection({ overview, timeZone }: { overview: ClientOverview; timeZone?: string }): JSX.Element {
  const m = overview.nextMeeting;
  if (!m) return <p className="tov-muted">{overview.meetingsCount === 0 ? 'No meetings or viewings yet.' : 'Nothing booked ahead.'}</p>;
  return (
    <p style={{ margin: 0 }}>
      <strong>{formatDateTime(m.datetime, timeZone)}</strong>{m.title ? ` · ${m.title}` : ''}{!m.confirmed ? <span className="tov-muted"> · not confirmed yet</span> : null}
    </p>
  );
}
