import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { getTheme, setTheme, type ThemeChoice } from '../styles/theme.js';
import { Spring } from '../motion/spring.js';
import { usePrefersReducedMotion } from '../motion/prefers.js';

const OPTIONS: Array<{ value: ThemeChoice; label: string }> = [
  { value: 'ledger', label: 'Ledger' },
  { value: 'vault', label: 'Vault' },
  { value: 'system', label: 'System' },
];

/** Calm segmented-control glide (near-critical, faint settle). */
const SEG_SPRING = { damping: 0.9, response: 0.35 } as const;

/**
 * The two materials, chosen by hand (docs/tovira-brand.md §1, §11). brand v1.2:
 * Ledger (light paper) is the default; Vault is the low-light option; System
 * follows the device. The brass selection SLIDES between segments (spring-driven
 * x/width, the same pattern as the tab bar) instead of teleporting — the label
 * colour transitions in step so text never flashes over bare paper. Placed
 * instantly on first paint and under reduced motion (apple-design §4/§7).
 */
export function ThemeToggle(): JSX.Element {
  const [choice, setChoice] = useState<ThemeChoice>(() => getTheme());
  const groupRef = useRef<HTMLDivElement>(null);
  const btnRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const markerRef = useRef<HTMLSpanElement>(null);
  const xs = useRef(new Spring(0, SEG_SPRING)).current;
  const ws = useRef(new Spring(0, SEG_SPRING)).current;
  const raf = useRef(0);
  const running = useRef(false);
  const last = useRef(0);
  const placed = useRef(false);
  const reduced = usePrefersReducedMotion();

  useLayoutEffect(() => {
    const group = groupRef.current;
    const marker = markerRef.current;
    const el = btnRefs.current[choice];
    if (!group || !marker || !el) return;
    const gRect = group.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    const x = rect.left - gRect.left;
    const w = rect.width;
    if (w <= 0) return; // no layout (jsdom)

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
  }, [choice, reduced, xs, ws]);

  useEffect(() => () => {
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf.current);
  }, []);

  function pick(next: ThemeChoice): void {
    setChoice(next);
    setTheme(next);
  }

  return (
    <section aria-label="Appearance" style={{ margin: '1.5rem 0' }}>
      <h2 style={{ fontSize: '1rem', marginTop: 0 }}>Appearance</h2>
      <div
        ref={groupRef}
        role="group"
        aria-label="Theme"
        style={{ position: 'relative', display: 'inline-flex', border: '1px solid var(--hairline)', borderRadius: 'var(--radius-card)', overflow: 'hidden' }}
      >
        <span
          ref={markerRef}
          aria-hidden="true"
          style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: 0, background: 'var(--brass)', opacity: 0, pointerEvents: 'none' }}
        />
        {OPTIONS.map((o) => {
          const active = choice === o.value;
          return (
            <button
              key={o.value}
              ref={(el) => {
                btnRefs.current[o.value] = el;
              }}
              type="button"
              aria-pressed={active}
              onClick={() => pick(o.value)}
              style={{
                position: 'relative',
                zIndex: 1,
                minHeight: 40,
                border: 'none',
                borderRadius: 0,
                padding: '0 16px',
                background: 'transparent',
                color: active ? 'var(--brass-ink)' : 'var(--text-secondary)',
                fontWeight: active ? 600 : 400,
                transition: 'color 250ms ease', // stay in step with the sliding marker
              }}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      <p style={{ color: 'var(--text-tertiary)', fontSize: '0.8rem', marginBottom: 0 }}>
        Ledger is the default. Vault suits low light; System follows your device.
      </p>
    </section>
  );
}
