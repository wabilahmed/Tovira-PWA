import { useEffect, useState, type ReactNode } from 'react';
import type { MondayDigest as Digest } from './mondayClient.js';
import { ReceiptThread } from '../receipts/ReceiptThread.js';
import { formatBody, formatRange, daysSince } from '../format/dates.js';
import { OutcomeControl, type OutcomeChoice } from '../outcomes/OutcomeControl.js';
import { Page, PageHeader } from '../ui/PageHeader.js';
import { aiText } from '../format/aiText.js';

export interface MondayApi {
  get(): Promise<Digest | null>;
}

/**
 * The Monday Statement (P3-8): a statement of the week ahead. A Fraunces headline
 * over a mono week-range meta line; four ruled sections, each a mono stamp label
 * with a right-hand mono count and a right-aligned mono date/figure column; the
 * one thing to do earns the single brass verb. Empty sections are hidden, never
 * padded.
 */
export function MondayDigest({ api, now = Date.now(), onSetOutcome }: { api: MondayApi; now?: number; onSetOutcome?: (clientId: string, choice: OutcomeChoice) => void | Promise<void> }): JSX.Element {
  const [digest, setDigest] = useState<Digest | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let live = true;
    void api.get().then((d) => {
      if (!live) return;
      if (d) { setDigest(d); setState('ready'); } else setState('error');
    });
    return () => { live = false; };
  }, [api]);

  // [P39-8] Loading and error states sit in the page template too.
  if (state === 'loading') return <Page testId="week-page" label="The Monday Statement"><PageHeader title="The Monday Statement" /><p className="ui-secondary">Building the Monday Statement…</p></Page>;
  if (state === 'error' || !digest) return <Page testId="week-page" label="The Monday Statement"><PageHeader title="The Monday Statement" /><p role="alert" className="ui-secondary">The Monday Statement could not be loaded. Try again in a moment.</p></Page>;

  // The server's Monday is authoritative; fall back to computing from `now`.
  const mondayMs = digest.weekOf ? Date.parse(digest.weekOf) : now - (((new Date(now).getDay() + 6) % 7) * 86_400_000);
  const week = formatRange(mondayMs, mondayMs + 6 * 86_400_000);

  const surfaced = digest.surfacedNotActed ?? [];

  // "Clear" means clear of OBLIGATIONS. If the only thing waiting is an unacted suggestion, the week
  // is still light — but we show that section rather than claim there is nothing at all.
  if (digest.isLight && surfaced.length === 0) {
    return (
      <Page testId="week-page" label="The Monday Statement">
        <PageHeader title="The Monday Statement" subtitle={`Week of ${week}`} />
        <p data-testid="clear-week" className="ui-secondary">A clear week. Nothing due, no one cooling.</p>
      </Page>
    );
  }

  return (
    <Page testId="week-page" label="The Monday Statement">
      {/* [P39 · owner] no "N entries" count on a screen. */}
      <PageHeader title="The Monday Statement" subtitle={`Week of ${week}`} />

      <Section testid="due" label="Promises due" count={digest.promisesDue.length}>
        {digest.promisesDue.map((p) => (
          <Row key={p.id} left={aiText(p.text)} right={p.dueDate ? formatBody(p.dueDate) : 'no date'} />
        ))}
      </Section>

      <Section testid="cooling" label="Cooling clients" count={digest.coolingClients.length}>
        {digest.coolingClients.map((c) => (
          <div key={c.id}>
            <Row left={c.name} right={c.lastTouchedAt ? `silent ${daysSince(c.lastTouchedAt, now)} days` : ''} claretRight />
            {onSetOutcome && <OutcomeControl clientName={c.name} onChoose={(choice) => onSetOutcome(c.id, choice)} />}
          </div>
        ))}
      </Section>

      <Section testid="questions" label="Unanswered questions" count={digest.unansweredQuestions.length}>
        <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
          {digest.unansweredQuestions.map((q, i) => (
            <ReceiptThread key={i} compact={false} refInfo={{ clientId: q.clientId, span: q.question, at: q.date, quote: q.question }} />
          ))}
        </div>
      </Section>

      <Section testid="dates" label="Dates ahead" count={digest.upcomingDates.length}>
        {digest.upcomingDates.map((d2, i) => (
          <Row key={i} left={d2.description} right={formatBody(d2.date)} />
        ))}
      </Section>

      {/* [INV-MATCH] Surfaced this week, not yet acted on — item to offer + the client's own words. */}
      <Section testid="surfaced" label="Surfaced, not yet acted" count={surfaced.length}>
        <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
          {surfaced.map((s, i) => (
            <div key={i}>
              <div>{s.itemTitle}</div>
              <ReceiptThread compact={false} refInfo={{ noteId: s.noteId, clientId: s.clientId, span: s.requirementRaw, at: s.statedOn, quote: s.requirementRaw }} />
            </div>
          ))}
        </div>
      </Section>
    </Page>
  );
}

function Section({ testid, label, count, children }: { testid: string; label: string; count: number; children: ReactNode }): JSX.Element | null {
  if (count === 0) return null;
  return (
    <div data-testid={testid} style={{ margin: 'var(--space-5) 0', paddingBottom: 'var(--space-3)', borderBottom: '1px solid var(--hairline)' }}>
      <div className="tov-stamp" style={{ marginBottom: 'var(--space-2)', display: 'flex', justifyContent: 'space-between', gap: 'var(--space-4)' }}>
        <span>{label}</span>
        <span>{String(count).padStart(2, '0')}</span>
      </div>
      {children}
    </div>
  );
}

function Row({ left, right, claretRight }: { left: string; right: string; claretRight?: boolean }): JSX.Element {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-4)', alignItems: 'baseline', padding: 'var(--space-1) 0' }}>
      <span>{left}</span>
      {right && <span className="tov-mono" style={{ color: claretRight ? 'var(--claret)' : 'var(--text-secondary)', fontSize: 'var(--text-secondary-size)', whiteSpace: 'nowrap' }}>{right}</span>}
    </div>
  );
}
