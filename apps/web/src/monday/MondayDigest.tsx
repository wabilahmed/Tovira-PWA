import { useEffect, useState } from 'react';
import type { MondayDigest as Digest } from './mondayClient.js';

export interface MondayApi {
  get(): Promise<Digest | null>;
}

/** The Monday Morning Scan (P3-8): the week ahead at a glance, in-app. */
export function MondayDigest({ api }: { api: MondayApi }): JSX.Element {
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

  if (state === 'loading') return <p>Building your Monday scan…</p>;
  if (state === 'error' || !digest) return <p role="alert">Couldn’t load your Monday scan.</p>;

  if (digest.isLight) {
    return (
      <section aria-label="Monday scan">
        <h2 style={{ marginTop: 0 }}>Your week</h2>
        <p data-testid="clear-week" style={{ color: 'var(--text-secondary)' }}>A clear week — nothing due, no one cooling. Nice.</p>
      </section>
    );
  }

  return (
    <section aria-label="Monday scan">
      <h2 style={{ marginTop: 0 }}>Your week</h2>
      <Group title="Promises due this week" testid="due" items={digest.promisesDue.map((p) => `${p.text}${p.dueDate ? ` — ${p.dueDate}` : ''}`)} />
      <Group title="Cooling clients" testid="cooling" items={digest.coolingClients.map((c) => c.name)} />
      <Group title="Unanswered questions" testid="questions" items={digest.unansweredQuestions.map((q) => `“${q.question}”`)} />
      <Group title="Upcoming dates" testid="dates" items={digest.upcomingDates.map((d) => `${d.description} — ${d.date}`)} />
    </section>
  );
}

function Group({ title, testid, items }: { title: string; testid: string; items: string[] }): JSX.Element | null {
  if (items.length === 0) return null;
  return (
    <div data-testid={testid} style={{ marginBottom: '1rem' }}>
      <strong>{title}</strong>
      <ul>{items.map((t, i) => <li key={i}>{t}</li>)}</ul>
    </div>
  );
}
