import { useEffect, useState } from 'react';
import { Badge, Banner, Chip, ChipGroup, EmptyState, ListRow, Page, PageHeader, Section } from '../ui/index.js';
import { ReceiptThread } from '../receipts/ReceiptThread.js';
import { leadStatusLabel } from '../clients/LeadStatus.js';
import type { FindApi, FindItem, FindQuery, FindResult, WantingBy, WantingOptions } from './findClient.js';

/**
 * [P39-7] Find — Ask became a list of fixed questions. Each one is answered from what is stored (no model, no
 * allowance), so every line carries its receipt and nothing is made up. A result screen: the question as its
 * title with "← Find", the count first, one row per item with a compact receipt, chips to narrow the result
 * (built from the result itself), and a plain line when there is nothing.
 */
export interface FindButton { id: FindQuery | 'clients'; label: string; noun: [string, string]; empty: string }

export const FIND_BUTTONS: FindButton[] = [
  { id: 'missed-promises', label: 'Missed promises', noun: ['missed promise', 'missed promises'], empty: "No missed promises. You're all caught up." },
  { id: 'due-this-week', label: 'Due this week', noun: ['promise due', 'promises due'], empty: 'Nothing is due this week.' },
  { id: 'no-reply', label: "Who hasn't replied in 2 weeks", noun: ['client', 'clients'], empty: 'Every client has replied in the last 2 weeks.' },
  { id: 'wanting', label: 'Clients wanting…', noun: ['client', 'clients'], empty: 'No clients want that right now.' },
  { id: 'deals-at-risk', label: 'Deals at risk', noun: ['client', 'clients'], empty: 'No deals look at risk right now.' },
  { id: 'open-requirements', label: 'Open requirements', noun: ['client', 'clients'], empty: 'No open requirements right now.' },
  { id: 'active-clients', label: 'Active clients', noun: ['client', 'clients'], empty: 'No active clients right now.' },
  { id: 'cold-clients', label: 'Cold clients', noun: ['client', 'clients'], empty: 'No cold clients right now.' },
  { id: 'clients', label: 'Full client list', noun: ['client', 'clients'], empty: '' },
];

const WANTING_TABS: Array<{ by: WantingBy; label: string }> = [
  { by: 'type', label: 'Property type' },
  { by: 'area', label: 'Area' },
  { by: 'budget', label: 'Budget' },
];

export type FindScreen = { kind: 'home' } | { kind: 'wanting' } | { kind: 'result'; button: FindButton; filter?: { by: WantingBy; value: string; label: string } };

export function Find({ api, onOpenClient, onOpenClients, screen: held, onScreen }: {
  api: FindApi;
  onOpenClient: (clientId: string) => void;
  onOpenClients: () => void;
  /** Where the rep is in Find, held by the app so opening a client and coming back returns here. */
  screen?: FindScreen;
  onScreen?: (s: FindScreen) => void;
}): JSX.Element {
  const [own, setOwn] = useState<FindScreen>({ kind: 'home' });
  const screen = held ?? own;
  const setScreen = (s: FindScreen): void => { setOwn(s); onScreen?.(s); };
  const home = (): void => setScreen({ kind: 'home' });

  if (screen.kind === 'wanting') {
    return <WantingStep api={api} onBack={home} onPick={(filter) => setScreen({ kind: 'result', button: FIND_BUTTONS.find((b) => b.id === 'wanting')!, filter })} />;
  }
  if (screen.kind === 'result') {
    return <FindResults api={api} button={screen.button} filter={screen.filter} onBack={screen.filter ? () => setScreen({ kind: 'wanting' }) : home} onOpenClient={onOpenClient} />;
  }
  return (
    <Page testId="find-page" label="Find">
      <PageHeader title="Find" subtitle="Answers from your clients' messages." />
      <ul className="ui-list" data-testid="find-buttons">
        {FIND_BUTTONS.map((b) => (
          <ListRow
            key={b.id}
            title={b.label}
            openLabel={b.label}
            onOpen={() => (b.id === 'clients' ? onOpenClients() : b.id === 'wanting' ? setScreen({ kind: 'wanting' }) : setScreen({ kind: 'result', button: b }))}
            trailing={<span aria-hidden="true" className="ui-caption">›</span>}
          />
        ))}
      </ul>
    </Page>
  );
}

/** "Clients wanting…": choose what (Property type / Area / Budget), then one of the values on record. */
function WantingStep({ api, onBack, onPick }: { api: FindApi; onBack: () => void; onPick: (f: { by: WantingBy; value: string; label: string }) => void }): JSX.Element {
  const [opts, setOpts] = useState<WantingOptions | 'paused' | null | undefined>(undefined);
  useEffect(() => { let live = true; void api.wantingOptions().then((o) => { if (live) setOpts(o); }); return () => { live = false; }; }, [api]);
  const values = (by: WantingBy): Array<{ value: string; label: string }> =>
    !opts || opts === 'paused' ? [] : by === 'budget' ? opts.budget : opts[by].map((v) => ({ value: v, label: v }));
  return (
    <Page testId="find-wanting" label="Clients wanting…">
      <PageHeader title="Clients wanting…" back={{ label: 'Find', onBack }} />
      {opts === undefined && <p className="ui-secondary">Loading…</p>}
      {opts === 'paused' && <Banner tone="warning">Find is paused while your subscription is inactive.</Banner>}
      {opts !== undefined && opts !== 'paused' && WANTING_TABS.map((t) => (
        <Section key={t.by} title={t.label}>
          {values(t.by).length === 0
            ? <p className="ui-secondary">None on record yet.</p>
            : (
              <ChipGroup label={t.label}>
                {values(t.by).map((v) => <Chip key={v.value} onClick={() => onPick({ by: t.by, value: v.value, label: v.label })}>{v.label}</Chip>)}
              </ChipGroup>
            )}
        </Section>
      ))}
    </Page>
  );
}

function FindResults({ api, button, filter, onBack, onOpenClient }: { api: FindApi; button: FindButton; filter?: { by: WantingBy; value: string; label: string }; onBack: () => void; onOpenClient: (id: string) => void }): JSX.Element {
  const [result, setResult] = useState<FindResult | 'paused' | null | undefined>(undefined);
  const [chip, setChip] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void api.run(button.id as FindQuery, filter ? { by: filter.by, value: filter.value } : undefined).then((r) => { if (live) setResult(r); });
    return () => { live = false; };
  }, [api, button.id, filter?.by, filter?.value]);

  const title = filter ? `Clients wanting ${filter.label}` : button.label;
  const header = <PageHeader title={title} back={{ label: filter ? 'Clients wanting…' : 'Find', onBack }} subtitle={result && result !== 'paused' ? countLine(result.count, button) : undefined} />;
  if (result === undefined) return <Page testId="find-result" label={title}>{header}<p className="ui-secondary">Loading…</p></Page>;
  if (result === 'paused') return <Page testId="find-result" label={title}>{header}<Banner tone="warning">Find is paused while your subscription is inactive.</Banner></Page>;
  if (result === null) return <Page testId="find-result" label={title}>{header}<Banner tone="danger">Couldn't load this. Try again.</Banner></Page>;

  const tags = [...new Set(result.items.flatMap((i) => i.tags))];
  const shown = chip ? result.items.filter((i) => i.tags.includes(chip)) : result.items;
  return (
    <Page testId="find-result" label={title}>
      {header}
      {result.count === 0 ? (
        <EmptyState title={button.empty} data-testid="find-empty" />
      ) : (
        <div className="ui-stack ui-gap-4">
          {tags.length > 1 && (
            <ChipGroup label="Narrow the result">
              <Chip selected={chip === null} count={result.items.length} onClick={() => setChip(null)}>All</Chip>
              {tags.map((t) => <Chip key={t} selected={chip === t} count={result.items.filter((i) => i.tags.includes(t)).length} onClick={() => setChip(t)}>{t}</Chip>)}
            </ChipGroup>
          )}
          <ul className="ui-list" data-testid="find-list">
            {shown.map((i, n) => <FindRow key={`${i.clientId}-${n}`} item={i} onOpen={() => onOpenClient(i.clientId)} />)}
          </ul>
          {result.footnote && <p className="ui-caption" data-testid="find-footnote">{result.footnote}</p>}
        </div>
      )}
    </Page>
  );
}

function FindRow({ item: i, onOpen }: { item: FindItem; onOpen: () => void }): JSX.Element {
  const whose = i.owner === 'rep' ? 'Yours' : i.owner === 'client' ? 'Theirs' : null;
  return (
    <ListRow
      testId="find-row"
      title={i.clientName}
      openLabel={`Open ${i.clientName}`}
      onOpen={onOpen}
      secondary={whose ? <><span className="ui-strong">{whose}:</span> {i.line}</> : i.line}
      meta={i.meta ?? undefined}
      trailing={i.overdue
        ? <Badge tone="danger" data-testid="due-badge">Overdue</Badge>
        : i.leadStatus ? <Badge data-testid="status-pill">{leadStatusLabel(i.leadStatus)}</Badge> : undefined}
      below={i.receipt
        ? <ReceiptThread refInfo={{ noteId: i.receipt.noteId, clientId: i.receipt.clientId, span: i.receipt.quote, at: i.receipt.at, quote: i.receipt.quote, sender: i.receipt.sender }} />
        : <p className="ui-caption" data-testid="receipt-empty">No source quote was saved for this.</p>}
    />
  );
}

export function countLine(n: number, b: FindButton): string {
  return `${n} ${n === 1 ? b.noun[0] : b.noun[1]}`;
}
