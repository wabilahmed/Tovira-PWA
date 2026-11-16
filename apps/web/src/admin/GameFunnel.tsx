import { useState } from 'react';
import { Chip, ChipGroup } from '../ui/index.js';
import type { GameFunnel, GameStep } from './adminClient.js';

/**
 * [P71-T · owner] The landing game's funnel, counted without cookies: view → start → chat 1 done → chat 5 done → end
 * screen → CTA tap → sign-up, with the count and the % drop from the step before, for the last 7 or 30 days; the same
 * split by industry (from the start, as a view has no industry yet); and the share of chats a wrong tap ended, per
 * chat number, which is where people give up. Read-only.
 */
const drop = (s: GameStep): string => (s.dropPct === null ? '' : s.dropPct > 0 ? `−${s.dropPct}%` : '0%');
const cell = { padding: 'var(--space-1) var(--space-1)', textAlign: 'right' as const, whiteSpace: 'nowrap' as const };

export function GameFunnelCard({ game }: { game: GameFunnel }): JSX.Element {
  const [win, setWin] = useState<'7d' | '30d'>('7d');
  const w = game[win];
  const anyChats = w.wrongShare.some((x) => x.chats > 0);
  return (
    <section data-testid="game-funnel" className="ui-stack ui-gap-2" style={{ marginBottom: 'var(--space-4)', maxWidth: 520 }}>
      <h2 style={{ fontSize: 'var(--text-title-size)', margin: 'var(--space-4) 0 0' }}>Game funnel</h2>
      <p className="ui-caption" style={{ margin: 0 }}>The landing page game, counted without cookies. Each step counts actions; nothing identifies a visitor.</p>
      <ChipGroup label="Game period">
        <Chip selected={win === '7d'} onClick={() => setWin('7d')}>7 days</Chip>
        <Chip selected={win === '30d'} onClick={() => setWin('30d')}>30 days</Chip>
      </ChipGroup>
      <ol className="ui-stack ui-gap-2" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {w.steps.map((s) => (
          <li key={s.key} data-testid={`game-step-${s.label}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-3)', borderBottom: '1px solid var(--hairline)', paddingBottom: 'var(--space-2)' }}>
            <span>{s.label}</span>
            <span style={{ display: 'inline-flex', gap: 'var(--space-3)', fontVariantNumeric: 'tabular-nums' }}>
              {drop(s) && <span className="ui-secondary">{drop(s)}</span>}
              <strong>{s.n}</strong>
            </span>
          </li>
        ))}
      </ol>
      <h3 style={{ fontSize: 'var(--text-body-size)', margin: 'var(--space-2) 0 0' }}>By industry</h3>
      <div style={{ overflowX: 'auto' }}>
        <table data-testid="game-by-industry" style={{ borderCollapse: 'collapse', fontSize: 'var(--text-secondary-size)', fontVariantNumeric: 'tabular-nums', width: '100%' }}>
          <thead>
            <tr className="ui-secondary">
              <th style={{ ...cell, textAlign: 'left', paddingInlineStart: 0 }}>Industry</th>
              <th style={cell}>Start</th><th style={cell}>Ch 1</th><th style={cell}>Ch 5</th><th style={cell}>End</th><th style={cell}>CTA</th><th style={{ ...cell, paddingInlineEnd: 0 }}>Signed up</th>
            </tr>
          </thead>
          <tbody>
            {w.byIndustry.map((r) => (
              <tr key={r.industry}>
                <th scope="row" style={{ ...cell, textAlign: 'left', paddingInlineStart: 0, fontWeight: 500, whiteSpace: 'normal' }}>{r.industry}</th>
                {r.steps.map((s, i) => <td key={s.key} style={i === r.steps.length - 1 ? { ...cell, paddingInlineEnd: 0 } : cell}>{s.n}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3 style={{ fontSize: 'var(--text-body-size)', margin: 'var(--space-2) 0 0' }}>Chats ended by a wrong tap</h3>
      {!anyChats ? <p className="ui-secondary" style={{ margin: 0 }}>No chats finished in this period yet.</p> : (
        <ul data-testid="game-wrong" className="ui-stack ui-gap-1" style={{ listStyle: 'none', padding: 0, margin: 0, fontVariantNumeric: 'tabular-nums' }}>
          {w.wrongShare.map((x) => (
            <li key={x.chat} style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
              <span>{`Chat ${x.chat}`}</span>
              <span className={x.pct === null ? 'ui-secondary' : undefined}>{x.pct === null ? 'None yet' : `${x.pct}% (${x.wrong} of ${x.chats})`}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
