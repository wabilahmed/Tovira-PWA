import { useEffect, useState } from 'react';
import type { AllowanceStatus } from './allowanceClient.js';
import type { CheckoutResult } from './allowanceClient.js';
import { exhaustedAction, exhaustedMessage, warnMessage, extraLine, usedLine, addedLine, fractionRead } from './usageCopy.js';
import { PurchaseMessages } from './PurchaseMessages.js';
import { SubscribeNow } from '../billing/SubscribeUpsell.js';
import type { Plan } from '../billing/plans.js';

export interface UsageMeterApi {
  status(): Promise<AllowanceStatus | null>;
  topUp(optionId: string): Promise<string | null>;
  /** [P83] A custom amount: only the message count is sent; the server prices it. */
  topUpCustom(messages: number): Promise<CheckoutResult>;
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

/** [P37] The balance before a top-up checkout, so the return can tell when the webhook has credited it. */
const BASELINE_KEY = 'tovira.topup.baseline';
function readBaseline(): { total: number } | null {
  try { const v = sessionStorage.getItem(BASELINE_KEY); return v ? (JSON.parse(v) as { total: number }) : null; } catch { return null; }
}
function writeBaseline(v: { total: number } | null): void {
  try { if (v) sessionStorage.setItem(BASELINE_KEY, JSON.stringify(v)); else sessionStorage.removeItem(BASELINE_KEY); } catch { /* storage optional */ }
}
/** Has a pack landed since the baseline? (More messages this month.) */
function credited(s: AllowanceStatus, base: { total: number } | null): boolean {
  if (!base) return s.lastTopupMessages != null && !s.exhausted;
  return s.messagesTotal > base.total;
}

/**
 * [USAGE-ALLOWANCE · D3/D8/D9/D10 → P37 → P83 · owner] Settings → Subscription's usage, in messages: ONE bar and
 * "2,340 of 10,000 messages read this month · resets 5 Dec", the unused pack messages ("never expire"), and the last
 * pack added. For an ACTIVE subscriber, "Add messages" opens the purchase screen right under the bar (the one place a
 * price appears before checkout). 80 / 95% lines once per threshold per month. Run out: "You've read your 10,000
 * messages this month. Resets 5 Dec." then the packs and "Choose your own amount" (a trial subscribes, a failed
 * payment updates the card). Back from a checkout it says "Updating your balance…" until the webhook has credited it.
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
  const read = fractionRead(s);
  const showWarnHard = !updating && read >= WARN_HARD_AT / 100 && !s.exhausted && !seen(`tovira.usage.95.${month}`);
  const showWarn = !updating && !showWarnHard && read >= WARN_AT / 100 && !s.exhausted && !seen(`tovira.usage.80.${month}`);
  const action = exhaustedAction(s);

  async function buy(optionId: string): Promise<void> {
    setBusy(optionId);
    writeBaseline({ total: s!.messagesTotal });
    const url = await api.topUp(optionId);
    setBusy(null);
    if (url) onRedirect(url);
    else writeBaseline(null);
  }
  async function buyCustom(messages: number): Promise<CheckoutResult> {
    setBusy('custom');
    writeBaseline({ total: s!.messagesTotal });
    const r = await api.topUpCustom(messages);
    setBusy(null);
    if ('url' in r) onRedirect(r.url);
    else writeBaseline(null);
    return r;
  }

  return (
    <section aria-label="Messages" data-testid="usage-meter">
      <div
        role="meter"
        aria-valuenow={s.messagesUsed}
        aria-valuemin={0}
        aria-valuemax={s.messagesTotal}
        aria-label="Messages read this month"
        data-testid="usage-bar"
        style={{ background: 'var(--surface-elevated)', borderRadius: 999, height: 10, overflow: 'hidden' }}
      >
        <div style={{ width: `${updating ? 0 : Math.round(read * 1000) / 10}%`, height: '100%', background: s.exhausted && !updating ? 'var(--claret)' : 'var(--green)' }} />
      </div>
      {updating
        ? <p data-testid="usage-updating" role="status">Updating your balance…</p>
        : <p data-testid="usage-used">{usedLine(s)}</p>}
      {!updating && s.packMessagesLeft > 0 && <p data-testid="usage-extra" className="tov-muted">{extraLine(s.packMessagesLeft)}</p>}
      {!updating && s.lastTopupMessages != null && <p data-testid="usage-added" className="tov-muted">{addedLine(s.lastTopupMessages)}</p>}

      {!updating && s.exhausted && (
        <div role="alert" data-testid="usage-paused">
          <p>{exhaustedMessage(s)}</p>
          {action === 'subscribe' && <SubscribeNow onSubscribe={onSubscribe} />}
          {action === 'update_card' && <button type="button" className="tov-primary" onClick={() => onUpdateCard?.()}>Update your card</button>}
        </div>
      )}

      {/* [P37 → P83] The one home of the purchase screen: directly under the bar, for an active subscriber. */}
      {!updating && s.canTopUp && (
        <div>
          <button type="button" data-tour="buy-more" className={s.exhausted ? 'tov-primary' : undefined} aria-expanded={picker || s.exhausted} onClick={() => setPicker((p) => !p)}>Add messages</button>
          {(picker || s.exhausted) && <PurchaseMessages options={s.options} custom={s.custom} busy={busy} onBuy={(id) => void buy(id)} onBuyCustom={buyCustom} />}
        </div>
      )}

      {showWarnHard && (
        <div role="status" data-testid="usage-warn-95">
          <p>{warnMessage(s)}</p>
          <button onClick={() => markSeen(`tovira.usage.95.${month}`)}>Dismiss</button>
        </div>
      )}
      {showWarn && (
        <div role="status" data-testid="usage-warn-80">
          <p>{warnMessage(s)}</p>
          <button onClick={() => markSeen(`tovira.usage.80.${month}`)}>Dismiss</button>
        </div>
      )}
    </section>
  );
}
