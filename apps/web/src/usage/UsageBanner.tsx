import { useEffect, useState } from 'react';
import type { UsageMeterApi } from './UsageMeter.js';
import type { AllowanceStatus } from './allowanceClient.js';
import { exhaustedAction, exhaustedMessage, warnMessage } from './usageCopy.js';
import { formatStamp } from '../format/dates.js';

/**
 * [P37] The usage warning on Today: at 80% and 95% of the allowance (month + extra usage together — a rep with
 * a balance isn't warned at 80% of the month alone) and at 100%. It never hosts the picker: "Buy more usage"
 * (an active subscriber), "Subscribe" (a trial / ended plan) or "Update your card" (a failed payment) all open
 * Settings → Subscription. Nothing below 80%.
 */
export function UsageBanner({ api, onOpenSubscription }: { api: Pick<UsageMeterApi, 'status'>; onOpenSubscription: () => void }): JSX.Element | null {
  const [s, setS] = useState<AllowanceStatus | null>(null);
  useEffect(() => {
    let live = true;
    void api.status().then((v) => { if (live) setS(v); });
    return () => { live = false; };
  }, [api]);
  if (!s || (!s.exhausted && s.percentUsed < 80)) return null;
  const level = s.exhausted ? 100 : s.percentUsed >= 95 ? 95 : 80;
  const action = exhaustedAction(s);
  const label = action === 'buy' ? 'Buy more usage' : action === 'update_card' ? 'Update your card' : 'Subscribe';
  const text = s.exhausted ? exhaustedMessage(s, s.resetAt ? formatStamp(s.resetAt) : 'your next billing month') : warnMessage(s.percentUsed);
  // Below 100% only a subscriber is offered anything (there is nothing to buy on a trial until it runs out).
  const showButton = s.exhausted || action === 'buy';
  return (
    <div className="lead-toast tov-usage-banner" role={s.exhausted ? 'alert' : 'status'} data-testid={`usage-banner-${level}`}>
      <span>{text}</span>
      {showButton && <button type="button" onClick={onOpenSubscription}>{label}</button>}
    </div>
  );
}
