import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { PRIMARY, OVERFLOW, type NavItem, type View } from './nav.js';
import { BottomSheet } from './BottomSheet.js';
import { NavBadge } from './NavBadge.js';
import { Spring } from '../motion/spring.js';
import { usePrefersReducedMotion } from '../motion/prefers.js';

/** The active-tab rule glides on a calm, near-critical spring. */
const MARKER_SPRING = { damping: 0.9, response: 0.4 } as const;

/**
 * The mobile bottom tab bar (brand §6): four primary tabs + More. The active
 * section is marked by a 2px brass rule that SPRINGS between tabs as you move —
 * decomposed into independent x/width springs (apple-design §4), interruptible,
 * and placed instantly (no glide) on first paint or under reduced motion. More
 * opens a fluid, draggable bottom sheet of the remaining sections.
 */
export function TabBar({ view, onNavigate, badges }: { view: View; onNavigate: (v: View) => void; badges?: Partial<Record<View, number>> }): JSX.Element {
  const [moreOpen, setMoreOpen] = useState(false);
  const activeOverflow = OVERFLOW.find((i) => i.view === view);
  const tabs: NavItem[] = activeOverflow ? [PRIMARY[0]!, PRIMARY[1]!, PRIMARY[2]!, activeOverflow] : PRIMARY;
  // A badge sitting in the More overflow surfaces on the More button itself (its section is hidden).
  const moreCount = OVERFLOW.reduce((n, i) => (i.view === activeOverflow?.view ? n : n + (badges?.[i.view] ?? 0)), 0);

  const navRef = useRef<HTMLElement>(null);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const reduced = usePrefersReducedMotion();
  useTabMarker(navRef, tabRefs, view, tabs.map((t) => t.view).join(), reduced);

  function go(v: View): void {
    onNavigate(v);
    setMoreOpen(false);
  }

  return (
    <>
      <BottomSheet open={moreOpen} onClose={() => setMoreOpen(false)} label="More sections">
        {OVERFLOW.map((i) => (
          <button
            key={i.view}
            type="button"
            className="tov-sheet__item"
            aria-current={view === i.view ? 'page' : undefined}
            onClick={() => go(i.view)}
          >
            {i.label}
            <NavBadge count={badges?.[i.view]} />
          </button>
        ))}
      </BottomSheet>
      <nav ref={navRef} className="tov-tabbar" aria-label="Sections">
        <span className="tov-tab__marker" aria-hidden="true" />
        {tabs.map((i) => (
          <button
            key={i.view}
            ref={(el) => {
              tabRefs.current[i.view] = el;
            }}
            type="button"
            className="tov-tab"
            aria-current={view === i.view ? 'page' : undefined}
            data-active={view === i.view || undefined}
            onClick={() => go(i.view)}
          >
            {i.label}
            <NavBadge count={badges?.[i.view]} />
          </button>
        ))}
        <button
          type="button"
          className="tov-tab"
          aria-expanded={moreOpen}
          data-active={moreOpen || undefined}
          onClick={() => setMoreOpen((s) => !s)}
        >
          More
          <NavBadge count={moreCount} />
        </button>
      </nav>
    </>
  );
}

/**
 * Drive the sliding brass rule. Measures the active tab and springs the marker's
 * x + width to it. Jumps (no animation) on the very first placement and whenever
 * reduced motion is asked for, or where there's no layout to measure (jsdom).
 */
function useTabMarker(
  navRef: React.RefObject<HTMLElement>,
  tabRefs: React.MutableRefObject<Record<string, HTMLButtonElement | null>>,
  activeView: View,
  tabsKey: string,
  reduced: boolean,
): void {
  const xs = useRef(new Spring(0, MARKER_SPRING)).current;
  const ws = useRef(new Spring(0, MARKER_SPRING)).current;
  const raf = useRef(0);
  const running = useRef(false);
  const last = useRef(0);
  const placed = useRef(false);

  useLayoutEffect(() => {
    const nav = navRef.current;
    const el = tabRefs.current[activeView];
    if (!nav) return;
    const marker = nav.querySelector<HTMLElement>('.tov-tab__marker');
    if (!marker || !el) return;

    const navRect = nav.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    const x = rect.left - navRect.left;
    const w = rect.width;
    if (w <= 0) return; // nothing laid out yet (jsdom / hidden)

    const paint = (): void => {
      marker.style.transform = `translateX(${xs.value}px)`;
      marker.style.width = `${ws.value}px`;
      marker.style.opacity = '1';
    };

    if (reduced || !placed.current) {
      xs.reset(x);
      ws.reset(w);
      placed.current = true;
      paint();
      return;
    }

    xs.setTarget(x);
    ws.setTarget(w);
    if (running.current || typeof requestAnimationFrame !== 'function') return;
    running.current = true;
    last.current = 0;
    const tick = (t: number): void => {
      const dt = last.current ? Math.min((t - last.current) / 1000, 1 / 30) : 1 / 60;
      last.current = t;
      const a = xs.step(dt);
      const b = ws.step(dt);
      paint();
      if (a || b) {
        raf.current = requestAnimationFrame(tick);
      } else {
        running.current = false;
      }
    };
    raf.current = requestAnimationFrame(tick);
  }, [activeView, tabsKey, reduced, navRef, tabRefs, xs, ws]);

  useEffect(() => () => {
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf.current);
  }, []);
}
