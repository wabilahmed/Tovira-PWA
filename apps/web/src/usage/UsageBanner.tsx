import { useEffect, useState } from 'react';
import type { UsageMeterApi } from './UsageMeter.js';
import type { AllowanceStatus } from './allowanceClient.js';
import { CHOOSE_OWN, exhaustedAction, exhaustedMessage, fractionRead, warnMessage } from './usageCopy.js';

/**
 * [P37 → P83 · owner, 21 Nov] The messages line on Today: at 80% and 95% of this month's messages (the month's plus
 * packs: a rep with a pack isn't warned at 80% of the month alone) and when they run out. Run out (a subscriber):
 * "You've read your 10,000 messages this month. Resets 5 Dec." then the three packs and "Choose your own amount", each
 * opening the purchase screen (Settings → Subscription), where the prices are. A trial subscribes, a failed payment
 * updates the card. Nothing below 80%. No AED here.
 */
export function UsageBanner({ api, onOpenSubscription }: { api: Pick<UsageMeterApi, 'status'>; onOpenSubscription: () => void }): JSX.Element | null {
  const [s, setS] = useState<AllowanceStatus | null>(null);
  useEffect(() => {
    let live = true;
    void api.status().then((v) => { if (live) setS(v); });
    return () => { live = false; };
  }, [api]);
  const read = s ? fractionRead(s) : 0;
  if (!s || (!s.exhausted && read < 0.8)) return null;
  const level = s.exhausted ? 100 : read >= 0.95 ? 95 : 80;
  const action = exhaustedAction(s);
  const text = s.exhausted ? exhaustedMessage(s) : warnMessage(s);
  return (
    <div className="lead-toast tov-usage-banner" role={s.exhausted ? 'alert' : 'status'} data-testid={`usage-banner-${level}`}>
      <span>{text}</span>
      {action === 'buy' && (
        <span style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1)' }}>
          {s.options.map((o) => <button key={o.id} type="button" data-testid={`banner-pack-${o.id}`} onClick={onOpenSubscription}>{o.label}</button>)}
          <button type="button" data-testid="banner-pack-custom" onClick={onOpenSubscription}>{CHOOSE_OWN}</button>
        </span>
      )}
      {s.exhausted && action === 'update_card' && <button type="button" onClick={onOpenSubscription}>Update your card</button>}
      {s.exhausted && action === 'subscribe' && <button type="button" onClick={onOpenSubscription}>Subscribe</button>}
    </div>
  );
}
