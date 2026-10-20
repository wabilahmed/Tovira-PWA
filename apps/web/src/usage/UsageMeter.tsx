import { useEffect, useState } from 'react';
import type { AllowanceStatus } from './allowanceClient.js';
import { packLabel, exhaustedAction, exhaustedMessage, warnMessage, extraLine } from './usageCopy.js';
import { formatStamp } from '../format/dates.js';
import { SubscribeNow } from '../billing/SubscribeUpsell.js';
import type { Plan } from '../billing/plans.js';

export interface UsageMeterApi {
  status(): Promise<AllowanceStatus | null>;
  topUp(optionId: string): Promise<string | null>;
}

/** The warning thresholds (D9). A banner shows once per threshold per allowance month. */
const WARN_AT = 80;
const WARN_HARD_AT = 95;

/**
 * [P20-1c] The usage percentage, rounded DOWN (D3), but precise enough to trust: a real but tiny
 * fraction reads "<1%" not a flat "0%", and under 10% it shows one decimal place. At 10%+ it's a whole
 * number, as before. Uses the unfloored rawPercentUsed when present, else the floored percentUsed.
 */
export function usageLabel(s: Pick<AllowanceStatus, 'percentUsed' | 'rawPercentUsed' | 'exhausted'>): string {
  if (s.exhausted) return '100%';
  const raw = s.rawPercentUsed ?? s.percentUsed;
  if (raw <= 0) return '0%';
  if (raw < 1) return '<1%';
  if (raw < 10) return `${Math.floor(raw * 10) / 10}%`; // one decimal, floored (never rounds up past real)
  return `${Math.floor(raw)}%`;
}

/** Per-viewer "seen this banner this month" memory. Best-effort — a convenience, never required. */
function seen(key: string): boolean {
  try { return localStorage.getItem(key) === '1'; } catch { return false; }
}
function markSeen(key: string): void {
  try { localStorage.setItem(key, '1'); } catch { /* private window / blocked — banner simply re-shows */ }
}

/** [P37] The balance before a top-up checkout, so the return can tell when the webhook has credited it. */
const BASELINE_KEY = 'tovira.topup.baseline';
function readBaseline(): { extra: number; percent: number } | null {
  try { const v = sessionStorage.getItem(BASELINE_KEY); return v ? (JSON.parse(v) as { extra: number; percent: number }) : null; } catch { return null; }
}
function writeBaseline(v: { extra: number; percent: number } | null): void {
  try { if (v) sessionStorage.setItem(BASELINE_KEY, JSON.stringify(v)); else sessionStorage.removeItem(BASELINE_KEY); } catch { /* storage optional */ }
}
/** Has a top-up landed since the baseline? (More balance, or a lower combined percentage.) */
function credited(s: AllowanceStatus, base: { extra: number; percent: number } | null): boolean {
  if (!base) return (s.extraPercentLeft ?? 0) > 0 && !s.exhausted;
  return (s.extraPercentLeft ?? 0) > base.extra || s.percentUsed < base.percent;
}

/**
 * [USAGE-ALLOWANCE · D3/D8/D9/D10 → P37] Settings → Subscription's usage: ONE bar, ONE percentage (month + extra
 * usage together) — no dirhams, tokens, or per-action cost — then the unspent extra usage ("+80% left, never
 * expires") and, for an ACTIVE subscriber only, "Buy more usage" directly under the bar (the one place the
 * picker lives). 80 / 95% banners once per threshold per month. At 100% the message follows the real
 * subscription state: a subscriber buys more, a trial subscribes, a failed payment updates the card. Back from a
 * top-up checkout it says "Updating your balance…" until the webhook has credited it — never a stale 100%.
 */
export function UsageMeter({
  api,
  onRedirect = (url) => { window.location.href = url; },
  onSubscribe,
  onUpdateCard,
  awaitingTopUp = false,
  onTopUpSettled,
  pollMs = 2000,
}: {
  api: UsageMeterApi;
  onRedirect?: (url: string) => void;
  /** [P11-1] A trial rep (no card → no top-up) gets the plan buttons at exhaustion instead of a dead end. */
  onSubscribe?: (plan: Plan) => void;
  /** [P37] A failed payment: open the billing portal to update the card. */
  onUpdateCard?: () => void;
  /** [P37] Back from a top-up checkout: poll until the balance has landed. */
  awaitingTopUp?: boolean;
  onTopUpSettled?: () => void;
  pollMs?: number;
}): JSX.Element | null {
  const [s, setS] = useState<AllowanceStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);
  const [updating, setUpdating] = useState(awaitingTopUp);

  useEffect(() => {
    let live = true;
    void api.status().then((v) => { if (live) { setS(v); setLoading(false); } });
    return () => { live = false; };
  }, [api]);

  // [P37] Back from checkout: poll (up to ~2 minutes) until the webhook has credited the top-up.
  useEffect(() => {
    if (!updating) return;
    const base = readBaseline();
    let tries = 0;
    const t = setInterval(() => {
      tries += 1;
      void api.status().then((v) => {
        if (!v) return;
        if (credited(v, base) || tries > Math.ceil(120_000 / pollMs)) {
          setS(v);
          setUpdating(false);
          writeBaseline(null);
          onTopUpSettled?.();
        }
      });
    }, pollMs);
    return () => clearInterval(t);
  }, [updating]);

  if (loading) return <p>Loading usage…</p>;
  if (!s) return null;

  const month = s.resetAt ? s.resetAt.slice(0, 7) : 'na';
  const showWarnHard = !updating && s.percentUsed >= WARN_HARD_AT && !s.exhausted && !seen(`tovira.usage.95.${month}`);
  const showWarn = !updating && !showWarnHard && s.percentUsed >= WARN_AT && !s.exhausted && !seen(`tovira.usage.80.${month}`);
  const resetWord = s.resetAt ? formatStamp(s.resetAt) : 'your next billing month';
  const extra = s.extraPercentLeft ?? 0;
  const action = exhaustedAction(s);

  async function buy(optionId: string): Promise<void> {
    setBusy(optionId);
    writeBaseline({ extra, percent: s!.percentUsed });
    const url = await api.topUp(optionId);
    setBusy(null);
    if (url) onRedirect(url);
    else writeBaseline(null);
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
        style={{ background: 'var(--surface-elevated)', borderRadius: 999, height: 10, overflow: 'hidden' }}
      >
        <div style={{ width: `${updating ? 0 : s.percentUsed}%`, height: '100%', background: s.exhausted && !updating ? 'var(--claret)' : 'var(--green)' }} />
      </div>
      {/* [P18-1] The reset date sits next to the percentage, so the number has a timeframe. */}
      {updating
        ? <p data-testid="usage-updating" role="status">Updating your balance…</p>
        : <p data-testid="usage-percent">{usageLabel(s)} of this month&rsquo;s usage used · resets {resetWord}</p>}
      {!updating && extra > 0 && <p data-testid="usage-extra" className="tov-muted">{extraLine(extra)}</p>}

      {/* [P37] The one home of the picker: directly under the bar, for an active subscriber, at any percentage. */}
      {!updating && s.canTopUp && (
        <div>
          <button type="button" className={s.exhausted ? 'tov-primary' : undefined} aria-expanded={picker || s.exhausted} onClick={() => setPicker((p) => !p)}>Buy more usage</button>
          {(picker || s.exhausted) && <TopUp options={s.options} busy={busy} onBuy={buy} />}
        </div>
      )}

      {!updating && s.exhausted && (
        <div role="alert" data-testid="usage-paused">
          <p>{exhaustedMessage(s, resetWord)}</p>
          {action === 'subscribe' && <SubscribeNow onSubscribe={onSubscribe} />}
          {action === 'update_card' && <button type="button" className="tov-primary" onClick={() => onUpdateCard?.()}>Update your card</button>}
        </div>
      )}

      {showWarnHard && (
        <div role="status" data-testid="usage-warn-95">
          <p>{warnMessage(s.percentUsed)}</p>
          <button onClick={() => markSeen(`tovira.usage.95.${month}`)}>Dismiss</button>
        </div>
      )}
      {showWarn && (
        <div role="status" data-testid="usage-warn-80">
          <p>{warnMessage(s.percentUsed)}</p>
          <button onClick={() => markSeen(`tovira.usage.80.${month}`)}>Dismiss</button>
        </div>
      )}
    </section>
  );
}

function TopUp({ options, busy, onBuy }: { options: AllowanceStatus['options']; busy: string | null; onBuy: (id: string) => void }): JSX.Element {
  return (
    <div data-testid="topup-sheet" style={{ display: 'grid', gap: '0.4rem', marginTop: '0.5rem' }}>
      {options.map((o) => (
        <button key={o.id} type="button" data-testid={`topup-${o.id}`} disabled={busy !== null} onClick={() => onBuy(o.id)}>
          {packLabel(o)}
        </button>
      ))}
    </div>
  );
}
