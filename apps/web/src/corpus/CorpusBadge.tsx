import { useEffect, useState } from 'react';
import type { CorpusStats } from './corpusClient.js';

export interface CorpusApi {
  get(): Promise<CorpusStats | null>;
}

/** "X months · Y moments" — the value the rep has banked (P4-10). Hidden until
 *  there's something to show, so a fresh account isn't taunted by zeros. */
export function CorpusBadge({ api }: { api: CorpusApi }): JSX.Element | null {
  const [stats, setStats] = useState<CorpusStats | null>(null);

  useEffect(() => {
    let live = true;
    void api.get().then((s) => {
      if (live) setStats(s);
    });
    return () => {
      live = false;
    };
  }, [api]);

  if (!stats || stats.moments === 0) return null;

  const months = stats.months === 1 ? '1 month' : `${stats.months} months`;
  const moments = stats.moments.toLocaleString();
  // The Statement of Holdings (§5): the banked value, set like a bank statement
  // line — mono figures under a brass rule. No emoji; the register speaks plainly.
  return (
    <span
      data-testid="corpus-badge"
      title="What Tovira remembers for you"
      className="tov-statement"
      style={{ display: 'inline-block', color: 'var(--text-secondary)', fontSize: '0.8rem' }}
    >
      <span className="tov-mono" style={{ color: 'var(--text-primary)' }}>{months}</span> · <span className="tov-mono" style={{ color: 'var(--text-primary)' }}>{moments} moment{stats.moments === 1 ? '' : 's'}</span>
    </span>
  );
}
