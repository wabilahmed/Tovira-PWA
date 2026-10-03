import { useEffect, useState } from 'react';
import type { AllowanceStatus } from './allowanceClient.js';
import { formatStamp } from '../format/dates.js';

export interface UsageMeterApi {
  status(): Promise<AllowanceStatus | null>;
  topUp(optionId: string): Promise<string | null>;
}

/** The warning thresholds (D9). A banner shows once per threshold per allowance month. */
const WARN_AT = 80;
const WARN_HARD_AT = 95;

/** Per-viewer "seen this banner this month" memory. Best-effort — a convenience, never required. */
function seen(key: string): boolean {
  try { return localStorage.getItem(key) === '1'; } catch { return false; }
}
function markSeen(key: string): void {
  try { localStorage.setItem(key, '1'); } catch { /* private window / blocked — banner simply re-shows */ }
}

/**
 * [USAGE-ALLOWANCE · D3/D8/D9/D10] The AI-usage meter: ONE bar, ONE percentage — no dirhams, tokens, or
 * per-action cost. Banners at 80% and 95% (once per threshold per month). At 100% a paused notice with
 * the reset date and, for a subscribed rep, the top-up options (their AED product prices).
 */
export function UsageMeter({
  api,
  onRedirect = (url) => { window.location.href = url; },
}: {
  api: UsageMeterApi;
  onRedirect?: (url: string) => void;
}): JSX.Element | null {
  const [s, setS] = useState<AllowanceStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void api.status().then((v) => { if (live) { setS(v); setLoading(false); } });
    return () => { live = false; };
  }, [api]);

  if (loading) return <p>Loading usage…</p>;
  if (!s) return null;

  const month = s.resetAt ? s.resetAt.slice(0, 7) : 'na';
  const showWarnHard = s.percentUsed >= WARN_HARD_AT && !s.exhausted && !seen(`tovira.usage.95.${month}`);
  const showWarn = !showWarnHard && s.percentUsed >= WARN_AT && !s.exhausted && !seen(`tovira.usage.80.${month}`);
  const resetWord = s.resetAt ? formatStamp(s.resetAt) : 'your next billing month';

  async function buy(optionId: string): Promise<void> {
    setBusy(optionId);
    const url = await api.topUp(optionId);
    setBusy(null);
    if (url) onRedirect(url);
  }

  return (
    <section aria-label="AI usage" data-testid="usage-meter">
      <div
        role="meter"
        aria-valuenow={s.percentUsed}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="AI usage this month"
        data-testid="usage-bar"
        style={{ background: '#eee', borderRadius: 999, height: 10, overflow: 'hidden' }}
      >
        <div style={{ width: `${s.percentUsed}%`, height: '100%', background: s.exhausted ? '#b00' : '#2a6' }} />
      </div>
      <p data-testid="usage-percent">{s.percentUsed}% of this month&rsquo;s usage used</p>

      {s.exhausted && (
        <div role="alert" data-testid="usage-paused">
          <p>AI features are paused until {resetWord}. Everything else — your book, briefs already made, and exporting your data — still works.</p>
          {s.canTopUp && <TopUp options={s.options} busy={busy} onBuy={buy} />}
        </div>
      )}

      {showWarnHard && (
        <div role="status" data-testid="usage-warn-95">
          <p>You&rsquo;ve used {s.percentUsed}% of this month&rsquo;s AI usage.</p>
          <button onClick={() => markSeen(`tovira.usage.95.${month}`)}>Dismiss</button>
          {s.canTopUp && <TopUp options={s.options} busy={busy} onBuy={buy} />}
        </div>
      )}
      {showWarn && (
        <div role="status" data-testid="usage-warn-80">
          <p>You&rsquo;ve used {s.percentUsed}% of this month&rsquo;s AI usage.</p>
          <button onClick={() => markSeen(`tovira.usage.80.${month}`)}>Dismiss</button>
        </div>
      )}
    </section>
  );
}

function TopUp({ options, busy, onBuy }: { options: AllowanceStatus['options']; busy: string | null; onBuy: (id: string) => void }): JSX.Element {
  return (
    <div data-testid="topup-sheet">
      <p>Add usage:</p>
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {options.map((o) => (
          <li key={o.id}>
            <button data-testid={`topup-${o.id}`} disabled={busy !== null} onClick={() => onBuy(o.id)}>
              {o.label} — AED {o.priceAed}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
