import { useEffect, useState } from 'react';
import type { LedgerEntry, LedgerSummary, WinBack } from './ledgerClient.js';
import { Page, PageHeader } from '../ui/PageHeader.js';
import { Button, Chip, ChipGroup, EmptyState, Toast } from '../ui/index.js';
import { ReceiptThread } from '../receipts/ReceiptThread.js';

export interface LedgerApi {
  summary(): Promise<LedgerSummary | null>;
  setEntryDealValue(entryId: string, aed: number | null): Promise<boolean>;
}

export type LedgerPeriod = 'month' | '3months' | 'all';
const PERIODS: Array<{ value: LedgerPeriod; label: string }> = [
  { value: 'month', label: 'This month' }, { value: '3months', label: 'Last 3 months' }, { value: 'all', label: 'All time' },
];

function periodStart(period: LedgerPeriod, now: number): number {
  if (period === 'all') return -Infinity;
  const d = new Date(now);
  return period === 'month' ? new Date(d.getFullYear(), d.getMonth(), 1).getTime() : new Date(d.getFullYear(), d.getMonth() - 3, d.getDate()).getTime();
}
const inPeriod = (e: LedgerEntry, period: LedgerPeriod, now: number): boolean => e.outcomeAt >= periodStart(period, now);

/**
 * [P46-5] The summary for a period: how many deals Tovira helped with, and the value of those deals from the values
 * the rep entered (null when none has a value: never an estimate). `withValue` counts the deals that have one.
 */
export function ledgerTotals(entries: LedgerEntry[], period: LedgerPeriod, now: number, winBacks: WinBack[] = []): { count: number; valueAed: number | null; withValue: number; wonBack: number } {
  const es = entries.filter((e) => inPeriod(e, period, now));
  const valued = es.filter((e) => e.dealValueAed !== null);
  // [P47-2] Clients won back: a count of their own, never part of the AED total (not a deal).
  const wonBack = winBacks.filter((w) => w.wroteBackAt >= periodStart(period, now)).length;
  return { count: es.length, valueAed: valued.length ? valued.reduce((s, e) => s + (e.dealValueAed ?? 0), 0) : null, withValue: valued.length, wonBack };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function shortDate(ms: number, now: number): string {
  const d = new Date(ms);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() === new Date(now).getFullYear() ? '' : ` ${d.getFullYear()}`}`;
}
const aed = (n: number): string => `AED ${n.toLocaleString('en-US')}`;

/**
 * [P46-5] The Ledger: "the record of what Tovira helped you win", the app paying for itself. A summary for the chosen
 * period, then one card per deal, newest first: the client, what Tovira did (the suggestion, with the client's words as
 * its receipt), what happened (marked bought), and the deal value entered on the card. An entry exists only where a
 * stored link joins Tovira's suggestion to a sale the rep marked; nothing is inferred.
 */
export function Ledger({ api, now = Date.now(), back, onOpenInventory }: {
  api: LedgerApi;
  now?: number;
  back?: { label: string; onBack: () => void };
  onOpenInventory?: () => void;
}): JSX.Element {
  const [data, setData] = useState<LedgerSummary | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [period, setPeriod] = useState<LedgerPeriod>('all');
  const [saved, setSaved] = useState(false);

  const load = (): Promise<void> => api.summary().then((s) => { if (s) { setData(s); setState('ready'); } else setState('error'); });
  useEffect(() => { void load(); }, [api]);

  const header = <PageHeader title="The Ledger" subtitle="What Tovira helped you win" {...(back ? { back } : {})} />;
  if (state === 'loading') return <Page testId="ledger-page" label="The Ledger">{header}<p className="ui-secondary">Loading your ledger…</p></Page>;
  if (state === 'error' || !data) return <Page testId="ledger-page" label="The Ledger">{header}<p role="alert" className="ui-secondary">Couldn’t load your ledger.</p></Page>;

  async function saveValue(id: string, value: number | null): Promise<boolean> {
    const ok = await api.setEntryDealValue(id, value);
    if (ok) {
      setData((d) => (d ? { ...d, entries: d.entries.map((e) => (e.id === id ? { ...e, dealValueAed: value } : e)) } : d));
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    }
    return ok;
  }

  if (data.entries.length === 0 && data.winBacks.length === 0) {
    return (
      <Page testId="ledger-page" label="The Ledger">
        {header}
        <EmptyState title="Nothing here yet." action={onOpenInventory ? <Button onClick={onOpenInventory}>Open Inventory</Button> : undefined}>
          When Tovira’s suggestion leads to a sale, it shows up here. Add what you sell in Inventory to start.
        </EmptyState>
      </Page>
    );
  }

  const totals = ledgerTotals(data.entries, period, now, data.winBacks);
  const shown = data.entries.filter((e) => inPeriod(e, period, now));
  const wonBack = data.winBacks.filter((w) => w.wroteBackAt >= periodStart(period, now));
  return (
    <Page testId="ledger-page" label="The Ledger">
      {header}
      <ChipGroup label="Period">
        {PERIODS.map((p) => <Chip key={p.value} selected={period === p.value} onClick={() => setPeriod(p.value)}>{p.label}</Chip>)}
      </ChipGroup>
      <div className="ui-card ui-stack ui-gap-3" data-testid="ledger-summary">
        <div>
          <p className="ui-label">Deals Tovira helped with</p>
          <p className="ui-title" data-testid="deals-count">{totals.count}</p>
        </div>
        <div>
          <p className="ui-label">Value of those deals</p>
          <p data-testid="deals-value" className={totals.valueAed === null ? 'ui-secondary' : 'ui-strong'}>
            {totals.valueAed === null ? 'Add deal values to see the total' : aed(totals.valueAed)}
            {totals.valueAed !== null && totals.withValue < totals.count && <span className="ui-caption ui-block">{totals.withValue} of {totals.count} deals have a value</span>}
          </p>
        </div>
        <div>
          <p className="ui-label">Clients won back</p>
          <p className="ui-title" data-testid="won-back-count">{totals.wonBack}</p>
        </div>
      </div>
      {shown.length === 0 ? (
        <p className="ui-secondary">No deals in this period.</p>
      ) : (
        <ul className="ui-plainlist ui-stack ui-gap-3">
          {shown.map((e) => <EntryCard key={e.id} entry={e} now={now} onSave={saveValue} />)}
        </ul>
      )}
      {/* [P47-2] Its own section under the deals: a client who wrote back within a week of a going-quiet alert. No AED. */}
      <section className="ui-stack ui-gap-3" aria-labelledby="ledger-winbacks" role="region" aria-label="Clients Tovira helped you win back">
        <h2 id="ledger-winbacks" className="ui-section-title">Clients Tovira helped you win back</h2>
        {wonBack.length === 0 ? (
          <p className="ui-secondary">When a client Tovira flagged as going quiet writes back within a week, it shows up here.</p>
        ) : (
          <ul className="ui-plainlist ui-stack ui-gap-3">
            {wonBack.map((w) => (
              <li key={w.id} className="ui-card ui-stack ui-gap-2" data-testid="ledger-winback">
                <span className="ui-strong" dir="auto">{w.clientName}</span>
                <p style={{ margin: 0 }}>Tovira flagged them as going quiet on {shortDate(w.flaggedAt, now)} ({w.silentDays} days silent)</p>
                <p style={{ margin: 0 }}>They wrote back on {shortDate(w.wroteBackAt, now)}</p>
                <ReceiptThread compact refInfo={{ noteId: w.receipt.noteId, clientId: w.clientId, span: w.receipt.quote, quote: w.receipt.quote, at: w.receipt.at }} />
              </li>
            ))}
          </ul>
        )}
      </section>
      {saved && <Toast>Saved</Toast>}
    </Page>
  );
}

function EntryCard({ entry: e, now, onSave }: { entry: LedgerEntry; now: number; onSave: (id: string, v: number | null) => Promise<boolean> }): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(e.dealValueAed === null ? '' : String(e.dealValueAed));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(): Promise<void> {
    const raw = draft.replace(/[,\s]/g, '').replace(/^AED/i, '');
    const value = raw === '' ? null : Number(raw);
    if (value !== null && (!Number.isFinite(value) || value < 0)) { setError('Enter the value as a number in AED, for example 12500.'); return; }
    setBusy(true);
    setError(null);
    if (await onSave(e.id, value)) setEditing(false);
    else setError('Could not save the value. Try again.');
    setBusy(false);
  }

  return (
    <li className="ui-card ui-stack ui-gap-2" data-testid="ledger-entry">
      <span className="ui-strong" dir="auto">{e.clientName}</span>
      <div className="ui-stack ui-gap-1">
        {/* [P47-1] a Won after a suggestion reads "Tovira suggested …"; a bought (or bought and Won) card keeps "Suggested …" */}
        <p style={{ margin: 0 }}>{e.outcome === 'won' ? 'Tovira suggested' : 'Suggested'} {e.itemTitle} on {shortDate(e.suggestedAt, now)}</p>
        {e.receipt && <ReceiptThread compact refInfo={{ noteId: e.receipt.noteId, clientId: e.clientId, span: e.receipt.quote, quote: e.receipt.quote, at: e.receipt.statedOn }} />}
      </div>
      <p style={{ margin: 0 }}>
        {e.outcome === 'won' && e.wonAt !== null && `You marked them Won on ${shortDate(e.wonAt, now)}`}
        {e.outcome === 'bought' && `Marked bought on ${shortDate(e.boughtAt ?? e.outcomeAt, now)}`}
        {e.outcome === 'bought_won' && e.wonAt !== null && `Marked bought on ${shortDate(e.boughtAt ?? e.outcomeAt, now)} · Won on ${shortDate(e.wonAt, now)}`}
      </p>
      {editing ? (
        <div className="ui-stack ui-gap-2">
          <label className="ui-field">
            <span className="ui-field__label">Deal value (AED)</span>
            <input className="ui-input" inputMode="numeric" value={draft} onChange={(ev) => setDraft(ev.target.value)} placeholder="e.g. 12500" />
          </label>
          {error && <p role="alert" className="ui-danger">{error}</p>}
          <div className="ui-cluster ui-gap-2">
            <Button size="sm" variant="primary" onClick={() => void save()} loading={busy}>Save</Button>
            <Button size="sm" variant="text" onClick={() => { setEditing(false); setError(null); }}>Cancel</Button>
          </div>
        </div>
      ) : e.dealValueAed === null ? (
        <div><Button size="sm" onClick={() => setEditing(true)}>+ Add deal value</Button></div>
      ) : (
        <div className="ui-cluster ui-cluster--between ui-gap-2">
          <span className="ui-strong">{aed(e.dealValueAed)}</span>
          <Button size="sm" variant="text" aria-label="Change deal value" onClick={() => setEditing(true)}>Change</Button>
        </div>
      )}
    </li>
  );
}
