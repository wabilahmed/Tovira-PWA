import { useEffect, useState } from 'react';
import type { ExtensionIncentive } from './billingClient.js';

export interface IncentiveApi {
  incentive(): Promise<ExtensionIncentive>;
}

const SEEN_KEY = 'tovira.trialExtensionSeen';

/**
 * The +7-day trial-extension incentive (P5-1-UI). Eligibility is decided ENTIRELY
 * by the server — this only renders the state it reports:
 *  - progress → "Notes on 2 of 3 clients — capture one more to earn +7 days."
 *  - earned   → a one-time confirmation with the new trial end. Dismissing it
 *               records a local flag so we don't nag on later visits (the server
 *               still says "earned"; the nudge just goes quiet — "already-extended").
 *  - hidden   → nothing (converted to paid, expired, or no trial).
 */
export function TrialIncentive({ api }: { api: IncentiveApi }): JSX.Element | null {
  const [inc, setInc] = useState<ExtensionIncentive | null>(null);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return window.localStorage.getItem(SEEN_KEY) === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    let live = true;
    void api.incentive().then((i) => {
      if (live) setInc(i);
    });
    return () => {
      live = false;
    };
  }, [api]);

  // A probe so tests (and the DOM) can tell "loaded, chose to render nothing"
  // apart from "still loading".
  if (!inc) return null;
  const probe = <span data-testid="incentive-probe" hidden />;

  if (inc.state === 'progress') {
    return (
      <section data-testid="incentive" aria-label="Trial extension progress" style={box}>
        {probe}
        <strong>Earn +{inc.extensionDays} more trial days</strong>
        <p style={{ margin: '0.25rem 0 0' }}>
          Notes on {inc.distinctClients} of {inc.needed} clients — capture{' '}
          {inc.remaining === 1 ? 'one more' : `${inc.remaining} more`} to earn +{inc.extensionDays} days.
        </p>
      </section>
    );
  }

  if (inc.state === 'earned' && !dismissed) {
    const newEnd = new Date(inc.trialEndsAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    return (
      <section data-testid="incentive-earned" aria-label="Trial extended" style={{ ...box, borderColor: 'var(--green-line)', background: 'var(--green-surface)' }}>
        {probe}
        <strong>You earned +<span className="tov-mono">{inc.extensionDays}</span> more trial days</strong>
        <p style={{ margin: '0.25rem 0' }}>Your trial now runs to <span className="tov-mono">{newEnd}</span>.</p>
        <button
          onClick={() => {
            try {
              window.localStorage.setItem(SEEN_KEY, '1');
            } catch {
              /* private mode — the banner just reappears next load, no harm */
            }
            setDismissed(true);
          }}
        >
          Got it
        </button>
      </section>
    );
  }

  // earned + dismissed (already-extended) or hidden → render nothing but the probe.
  return probe;
}

const box: React.CSSProperties = { border: '1px solid var(--hairline)', borderRadius: 8, padding: '0.75rem 1rem', margin: '0.75rem 0' };
