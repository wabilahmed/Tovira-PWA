import { useEffect, useState } from 'react';

/**
 * [SW-UPDATE] The "New version available — Reload" prompt. A new service worker installs and WAITS
 * (sw.ts no longer auto-skipWaiting), and registerServiceWorker dispatches a `tovira:sw-update` window
 * event carrying `apply`. We show a calm banner; on Reload we call `apply()` (posts SKIP_WAITING → the
 * worker activates → registerServiceWorker reloads once). A prompt, not a silent reload, because the
 * rep may be mid-capture — their outbox lives in IndexedDB and survives the reload regardless.
 */
export function UpdatePrompt(): JSX.Element | null {
  const [apply, setApply] = useState<(() => void) | null>(null);

  useEffect(() => {
    const onUpdate = (e: Event): void => {
      const fn = (e as CustomEvent<{ apply?: () => void }>).detail?.apply;
      if (fn) setApply(() => fn); // store the function (not call it) — the rep decides when
    };
    window.addEventListener('tovira:sw-update', onUpdate as EventListener);
    return () => window.removeEventListener('tovira:sw-update', onUpdate as EventListener);
  }, []);

  if (!apply) return null;

  return (
    <div
      role="status"
      data-testid="sw-update-prompt"
      style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', justifyContent: 'center', background: 'var(--brass, #8a6d3b)', color: 'var(--brass-ink, #fff)', padding: '0.6rem 1rem', fontSize: '0.9rem' }}
    >
      <span>New version available.</span>
      <button type="button" className="tov-primary" onClick={() => apply()}>Reload</button>
    </div>
  );
}
