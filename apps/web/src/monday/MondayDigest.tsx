import { useEffect, useState, type ReactNode } from 'react';
import type { MondayDigest as Digest } from './mondayClient.js';
import { Receipt } from '../components/Receipt.js';
import { formatBody, formatRange, daysSince } from '../format/dates.js';

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
export function MondayDigest({ api, now = Date.now() }: { api: MondayApi; now?: number }): JSX.Element {
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

  if (state === 'loading') return <p>Building the Monday Statement…</p>;
  if (state === 'error' || !digest) return <p role="alert">The Monday Statement could not be loaded. Try again in a moment.</p>;

  // The server's Monday is authoritative; fall back to computing from `now`.
  const mondayMs = digest.weekOf ? Date.parse(digest.weekOf) : now - (((new Date(now).getDay() + 6) % 7) * 86_400_000);
  const week = formatRange(mondayMs, mondayMs + 6 * 86_400_000);

  if (digest.isLight) {
    return (
      <section aria-label="The Monday Statement">
        <header className="tov-screenhead">
          <h2>The Monday Statement</h2>
          <div className="tov-screenmeta">Week of {week} · 0 entries</div>
        </header>
        <p data-testid="clear-week" style={{ color: 'var(--text-secondary)' }}>A clear week — nothing due, no one cooling.</p>
      </section>
    );
  }

  const entries =
    digest.promisesDue.length + digest.coolingClients.length + digest.unansweredQuestions.length + digest.upcomingDates.length;

  return (
    <section aria-label="The Monday Statement">
      <header className="tov-screenhead">
        <h2>The Monday Statement</h2>
        <div className="tov-screenmeta">Week of {week} · {entries} entr{entries === 1 ? 'y' : 'ies'}</div>
      </header>

      <Section testid="due" label="Promises due" count={digest.promisesDue.length}>
        {digest.promisesDue.map((p) => (
          <Row key={p.id} left={p.text} right={p.dueDate ? formatBody(p.dueDate) : 'no date'} />
        ))}
      </Section>

      <Section testid="cooling" label="Cooling clients" count={digest.coolingClients.length}>
        {digest.coolingClients.map((c) => (
          <Row key={c.id} left={c.name} right={c.lastTouchedAt ? `silent ${daysSince(c.lastTouchedAt, now)} days` : ''} claretRight />
        ))}
      </Section>

      <Section testid="questions" label="Unanswered questions" count={digest.unansweredQuestions.length}>
        <div style={{ display: 'grid', gap: '0.5rem' }}>
          {digest.unansweredQuestions.map((q, i) => (
            <Receipt key={i} quote={q.question} date={q.date} />
          ))}
        </div>
      </Section>

      <Section testid="dates" label="Dates ahead" count={digest.upcomingDates.length}>
        {digest.upcomingDates.map((d2, i) => (
          <Row key={i} left={d2.description} right={formatBody(d2.date)} />
        ))}
      </Section>
    </section>
  );
}

function Section({ testid, label, count, children }: { testid: string; label: string; count: number; children: ReactNode }): JSX.Element | null {
  if (count === 0) return null;
  return (
    <div data-testid={testid} style={{ margin: '1.25rem 0', paddingBottom: '0.75rem', borderBottom: '1px solid var(--hairline)' }}>
      <div className="tov-stamp" style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
        <span>{label}</span>
        <span>{String(count).padStart(2, '0')}</span>
      </div>
      {children}
    </div>
  );
}

function Row({ left, right, claretRight }: { left: string; right: string; claretRight?: boolean }): JSX.Element {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'baseline', padding: '3px 0' }}>
      <span>{left}</span>
      {right && <span className="tov-mono" style={{ color: claretRight ? 'var(--claret)' : 'var(--text-secondary)', fontSize: '0.85rem', whiteSpace: 'nowrap' }}>{right}</span>}
    </div>
  );
}
