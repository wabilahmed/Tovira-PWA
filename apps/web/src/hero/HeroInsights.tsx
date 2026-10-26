import { useEffect, useState, type ReactNode } from 'react';
import type { GateState, Pattern, RiskItem, TodayAction } from './heroClient.js';
import { ReceiptThread } from '../receipts/ReceiptThread.js';
import { formatBody } from '../format/dates.js';
import { Badge, Card, IconButton, Page, PageHeader, Section } from '../ui/index.js';
import { aiText } from '../format/aiText.js';

export interface HeroApi {
  status(): Promise<GateState | null>;
  patterns(): Promise<Pattern[]>;
  risk(): Promise<RiskItem[]>;
  today(): Promise<{ actions: TodayAction[]; refreshesRemaining: number | null }>;
  refreshToday(): Promise<{ actions: TodayAction[]; refreshesRemaining: number } | 'rate_limited' | null>;
}

/** [P39-5] "Wednesday 21 Oct" — the date under the Today title, in the rep's own clock. */
export function todaySubtitle(now: Date): string {
  const weekday = now.toLocaleDateString('en-GB', { weekday: 'long' });
  const dayMonth = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return `${weekday} ${dayMonth}`;
}

/** The rep's local calendar day, YYYY-MM-DD. */
export function localIsoDate(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** [P39-5] The status badge on a promise: "Overdue" (danger) / "Due today" / "Due Thu". Null without a due date. */
export function dueBadge(dueDate: string | undefined, today: string): { label: string; tone?: 'danger' } | null {
  if (!dueDate) return null;
  if (dueDate < today) return { label: 'Overdue', tone: 'danger' };
  if (dueDate === today) return { label: 'Due today' };
  const [y, m, d] = dueDate.split('-').map(Number) as [number, number, number];
  return { label: `Due ${new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short' })}` };
}

/**
 * The Today screen (P4b-* → [P39-5] on the design system). Three sections, each with a one-line explanation:
 *   1. To do today — what's due and who's waiting (always on);
 *   2. Deals at risk — clients who may be slipping, each reason WITH its receipt (a reason without one is not
 *      shown); volume-gated, below the gate the honest "what unlocks it" state (P34-6);
 *   3. Needs your answer — the To Confirm preview, passed in by the app.
 */
export function HeroInsights({ api, now = () => new Date(), top, needsAnswer }: {
  api: HeroApi;
  now?: () => Date;
  /** Banners above the sections (allowance, misfiled-note suggestions). */
  top?: ReactNode;
  /** [P39-5] Section 3: the To Confirm preview. */
  needsAnswer?: ReactNode;
}): JSX.Element {
  const [status, setStatus] = useState<GateState | null>(null);
  const [actions, setActions] = useState<TodayAction[]>([]);
  const [risk, setRisk] = useState<RiskItem[]>([]);
  const [loading, setLoading] = useState(true);
  // [P34-5] No counter while a refresh is left; at zero the button is disabled with the overnight copy.
  const [outOfRefreshes, setOutOfRefreshes] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let live = true;
    // [P39-5] Patterns are not on Today: they carry no message receipt. Only risk reasons with one are shown.
    void Promise.all([api.status(), api.today(), api.risk()]).then(([s, t, r]) => {
      if (!live) return;
      setStatus(s);
      setActions(Array.isArray(t?.actions) ? t.actions : []); // a malformed body never crashes the screen
      setOutOfRefreshes(t?.refreshesRemaining === 0);
      setRisk(Array.isArray(r) ? r : []);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [api]);

  async function refresh(): Promise<void> {
    setRefreshing(true);
    const r = await api.refreshToday();
    setRefreshing(false);
    if (r === 'rate_limited') {
      setOutOfRefreshes(true);
    } else if (r) {
      setActions(r.actions);
      setOutOfRefreshes(r.refreshesRemaining === 0);
    }
  }

  const today = localIsoDate(now());
  const header = (
    <PageHeader
      title="Today"
      subtitle={todaySubtitle(now())}
      action={!loading && (
        <IconButton label="Refresh" onClick={() => void refresh()} disabled={refreshing || outOfRefreshes} aria-busy={refreshing || undefined}>↻</IconButton>
      )}
    />
  );
  if (loading) return <Page testId="today-page" label="Today">{header}<p className="ui-secondary">Working out your day…</p></Page>;

  // A client is listed only with at least one reason that has its receipt.
  const atRisk = risk
    .map((r) => ({ ...r, shown: (r.details ?? []).filter((d) => d.receipt && d.receipt.quote) }))
    .filter((r) => r.shown.length > 0);

  return (
    <Page testId="today-page" label="Today">
      {header}
      {outOfRefreshes && <p data-testid="refresh-msg" className="ui-secondary">Updated overnight. Next refresh tomorrow.</p>}
      {top}

      <Section title="To do today" explanation="What's due and who's waiting on you.">
        {actions.length === 0 ? (
          <p className="ui-secondary">Nothing for today yet. Capture a note after your next conversation and tomorrow&rsquo;s list will write itself.</p>
        ) : (
          <ul data-testid="today-list" className="ui-stack ui-gap-3 ui-plainlist">
            {actions.map((a, i) => {
              const badge = a.kind === 'promise' ? dueBadge(a.dueDate, today) : null;
              return (
                <li key={i}>
                  <Card>
                    <div className="ui-cluster ui-cluster--between ui-cluster--nowrap ui-gap-2">
                      <p className="ui-body" dir="auto"><TodayLead action={a} /></p>
                      {badge && <Badge tone={badge.tone} data-testid="due-badge">{badge.label}</Badge>}
                    </div>
                    {a.subline && <p className="ui-secondary">{a.subline}</p>}
                    {/* [P34-7 → P35-3] where it came from, as the source chat bubble — tap for the conversation */}
                    <ReceiptThread
                      refInfo={a.receipt?.quote ? { noteId: a.receipt.noteId ?? null, clientId: a.clientId, span: a.receipt.quote, at: a.receipt.at, quote: a.receipt.quote, sender: a.receipt.source === 'capture' ? 'Your note' : a.clientName ?? null } : {}}
                      emptyText={!a.receipt ? 'Source shows after the next refresh' : a.receipt.source === 'contact' ? `Last contact ${formatBody(a.receipt.at ?? '')}` : 'No source quote was saved for this fact'}
                    />
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section title="Deals at risk" explanation="Clients who may be slipping, and why.">
        {status && !status.unlocked ? (
          <Card role="status">
            <p className="ui-body">{gateCopy(status)}</p>
            <div className="ui-stack ui-gap-1">
              <div className="ui-cluster ui-cluster--between ui-secondary"><span>Clients on file</span><span>{status.counts.clients} / {status.counts.clients + status.needed.clients}</span></div>
              <div className="ui-cluster ui-cluster--between ui-secondary"><span>Notes captured</span><span>{status.counts.notes} / {status.counts.notes + status.needed.notes}</span></div>
            </div>
            <p className="ui-caption">
              {status.needed.clients > 0 && `${status.needed.clients} more clients`}
              {status.needed.clients > 0 && status.needed.notes > 0 && ' and '}
              {status.needed.notes > 0 && `${status.needed.notes} more notes`}.
            </p>
          </Card>
        ) : atRisk.length === 0 ? (
          <p className="ui-secondary">Nothing stands out right now.</p>
        ) : (
          <ul className="ui-stack ui-gap-3 ui-plainlist">
            {atRisk.map((r) => (
              <li key={r.clientId}>
                <Card tone="danger" data-testid="risk">
                  <p className="ui-body ui-strong" dir="auto">{r.name}</p>
                  {r.shown.map((d) => (
                    <div key={d.reason} className="ui-stack ui-gap-2" data-testid="risk-reason">
                      <p className="ui-secondary">{d.reason}</p>
                      <ReceiptThread refInfo={{ noteId: d.receipt!.noteId ?? null, clientId: r.clientId, span: d.receipt!.quote, at: d.receipt!.at, quote: d.receipt!.quote, sender: r.name }} />
                    </div>
                  ))}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {needsAnswer}
    </Page>
  );
}

/** [P34-2] "**Sara Khan** · Send the floor plans", "**Sara Khan** promised: Send ID document photos", or
 *  "**Your note** · …" when the item genuinely has no client. Older payloads (no clientName/title) fall back to
 *  the action's text as before. */
function TodayLead({ action: a }: { action: TodayAction }): JSX.Element {
  if (a.clientName === undefined) return <>{aiText(a.text)}</>;
  const who = a.clientName ?? 'Your note';
  return (
    <>
      <strong>{who}</strong>
      {a.owner === 'client' ? ' promised: ' : ' · '}
      <span>{aiText(a.title ?? a.text)}</span>
    </>
  );
}

/** [P34-6] Why Patterns & risk is empty below the volume gate — quoting the server's REAL thresholds, and only
 *  the dimension(s) still short: "Patterns appear once you have 5 clients and 20 notes. You have 4 clients and
 *  12 notes." / "Patterns appear once you have 20 notes. You have 12." */
export function gateCopy(s: GateState): string {
  const t = s.thresholds ?? { clients: s.counts.clients + s.needed.clients, notes: s.counts.notes + s.needed.notes };
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const short = (['clients', 'notes'] as const).filter((k) => s.needed[k] > 0);
  if (short.length === 0) return 'Patterns appear as your book grows.';
  const word = (k: 'clients' | 'notes') => (k === 'clients' ? 'client' : 'note');
  if (short.length === 1) {
    const k = short[0]!;
    return `Patterns appear once you have ${plural(t[k], word(k))}. You have ${s.counts[k]}.`;
  }
  return `Patterns appear once you have ${plural(t.clients, 'client')} and ${plural(t.notes, 'note')}. You have ${plural(s.counts.clients, 'client')} and ${plural(s.counts.notes, 'note')}.`;
}
