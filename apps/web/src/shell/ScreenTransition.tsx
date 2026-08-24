import { useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { Spring, runSpring } from '../motion/spring.js';
import { usePrefersReducedMotion } from '../motion/prefers.js';

/** Calm, critically damped — a settle, never a bounce (apple-design restraint). */
const SCREEN_SPRING = { damping: 1.0, response: 0.32 } as const;

/**
 * The transition felt on every section change: the incoming screen SETTLES in —
 * a short rise + fade on a critically damped spring, written straight to the DOM
 * per frame. Deliberately restrained (no overshoot on something that merely
 * appeared). Instant under reduced motion. It clears its inline transform at rest
 * so the wrapper never becomes a containing block for sticky/fixed descendants.
 */
export function ScreenTransition({ viewKey, children }: { viewKey: string; children: ReactNode }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const spring = useRef(new Spring(0, SCREEN_SPRING)).current;
  const stopRef = useRef<(() => void) | null>(null);
  const reduced = usePrefersReducedMotion();

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    stopRef.current?.();
    const paint = (v: number): void => {
      el.style.opacity = String(v);
      // At rest, drop the transform entirely (translateY(0) would still create a
      // containing block and trap sticky/fixed children).
      el.style.transform = v >= 0.999 ? '' : `translateY(${(1 - v) * 8}px)`;
    };
    if (reduced) {
      spring.reset(1);
      el.style.opacity = '';
      el.style.transform = '';
      return;
    }
    spring.reset(0);
    paint(0);
    spring.setTarget(1);
    stopRef.current = runSpring(spring, paint, () => {
      el.style.opacity = '';
      el.style.transform = '';
    });
    return () => stopRef.current?.();
  }, [viewKey, reduced, spring]);

  return (
    <div ref={ref} className="tov-screenwrap">
      {children}
    </div>
  );
}
