import { useEffect, useState } from 'react';

/**
 * React to a media query, live. Defaults to `false` where matchMedia is absent
 * (jsdom / SSR) so motion code degrades to its non-animated path in tests.
 */
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => matchQuery(query));
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(query);
    const on = (): void => setMatches(mql.matches);
    on();
    mql.addEventListener?.('change', on);
    return () => mql.removeEventListener?.('change', on);
  }, [query]);
  return matches;
}

function matchQuery(query: string): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
}

/** True when the viewer has asked for reduced motion — swap springs for a fade. */
export function usePrefersReducedMotion(): boolean {
  return useMediaQuery('(prefers-reduced-motion: reduce)');
}
