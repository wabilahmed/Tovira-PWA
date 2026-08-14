import { useEffect, useState } from 'react';

/** The board's desktop breakpoint (sidebar + split views appear at ≥1180px). */
const QUERY = '(min-width: 1180px)';

/**
 * True on the desktop layout. Defaults to `false` when matchMedia is absent
 * (jsdom / SSR), so the mobile bottom-tab shell is the only nav rendered in
 * tests — no duplicate nav buttons.
 */
export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState<boolean>(() => match());

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(QUERY);
    const on = (): void => setIsDesktop(mql.matches);
    on();
    mql.addEventListener?.('change', on);
    return () => mql.removeEventListener?.('change', on);
  }, []);

  return isDesktop;
}

function match(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(QUERY).matches;
}
