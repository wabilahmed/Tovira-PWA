import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Spring, runSpring } from '../motion/spring.js';
import { project, rubberband, nearestSnap } from '../motion/projection.js';
import { usePrefersReducedMotion } from '../motion/prefers.js';

/** Drawer spring (apple-design §4): a touch of bounce, because a flick precedes it. */
const SHEET_SPRING = { damping: 0.82, response: 0.35 } as const;

interface DragState {
  startPointerY: number;
  startY: number;
  history: { t: number; y: number }[];
}

/**
 * A fluid, gesture-driven bottom sheet — the apple-design principles made real:
 *
 *  • Materialize (§12): glass blur + a dimming scrim; springs up from off-screen.
 *  • Direct manipulation (§2): the sheet tracks the finger 1:1, from wherever it
 *    was grabbed, even mid-flight — the open/close spring is interrupted, not
 *    queued (§3).
 *  • Momentum (§5,§6): on release we PROJECT where the flick is going and snap to
 *    the nearer of open/closed, handing the finger's velocity to the spring so
 *    there's no seam between drag and animation.
 *  • Rubber-band (§9): dragging above the open position resists instead of
 *    stopping dead.
 *  • Reduced motion (§14): no slide/spring — a plain cross-fade, and the sheet
 *    mounts/unmounts at once.
 *
 * The transform is written straight to the DOM each frame (never React state) so
 * it stays on the compositor at 60fps. In a non-visual environment (jsdom: the
 * sheet has no measured height) it degrades to an instant open/close so the menu
 * is always in the DOM for its consumers.
 */
export function BottomSheet({
  open,
  onClose,
  label,
  children,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  children: ReactNode;
}): JSX.Element | null {
  const [mounted, setMounted] = useState(open);
  const sheetRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const springRef = useRef(new Spring(0, SHEET_SPRING));
  const stopRef = useRef<(() => void) | null>(null);
  const heightRef = useRef(1);
  const dragRef = useRef<DragState | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const reduced = usePrefersReducedMotion();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const stop = useCallback(() => {
    stopRef.current?.();
    stopRef.current = null;
  }, []);

  /** Write the live y (px from the open position) to transform + scrim opacity. */
  const paint = useCallback((y: number) => {
    const H = heightRef.current || 1;
    if (sheetRef.current) sheetRef.current.style.transform = `translateY(${y}px)`;
    if (scrimRef.current) scrimRef.current.style.opacity = String(Math.max(0, Math.min(1, 1 - y / H)));
  }, []);

  const springTo = useCallback(
    (target: number, velocity: number | undefined, onRest?: () => void) => {
      stop();
      springRef.current.setTarget(target, velocity !== undefined ? { velocity } : undefined);
      stopRef.current = runSpring(springRef.current, paint, () => {
        stopRef.current = null;
        onRest?.();
      });
    },
    [paint, stop],
  );

  // Mount → measure and materialize up into view (or place instantly).
  useLayoutEffect(() => {
    if (!mounted) return;
    const sheet = sheetRef.current;
    if (!sheet) return;
    restoreFocusRef.current = (document.activeElement as HTMLElement) ?? null;
    try {
      sheet.focus({ preventScroll: true });
    } catch {
      /* focus is a nicety */
    }
    const H = sheet.getBoundingClientRect().height;
    if (reduced || H <= 0) {
      heightRef.current = Math.max(H, 1);
      springRef.current.reset(0);
      paint(0);
      return;
    }
    heightRef.current = H;
    springRef.current.reset(H); // start below the fold…
    paint(H);
    springTo(0, undefined); // …and spring up
    return () => {
      const prev = restoreFocusRef.current;
      if (prev && typeof prev.focus === 'function') {
        try {
          prev.focus({ preventScroll: true });
        } catch {
          /* noop */
        }
      }
    };
  }, [mounted]);

  // React to the `open` prop: bring the sheet in, or animate it out and unmount.
  useEffect(() => {
    if (open) {
      if (!mounted) setMounted(true);
      return;
    }
    if (!mounted) return;
    const H = heightRef.current;
    if (reduced || H <= 1) {
      setMounted(false);
      return;
    }
    springTo(H, undefined, () => setMounted(false));
  }, [open]);

  // Stop any running spring on unmount.
  useEffect(() => () => stop(), [stop]);

  // Escape closes.
  useEffect(() => {
    if (!mounted) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mounted]);

  function onPointerDown(e: React.PointerEvent): void {
    if (reduced || heightRef.current <= 1) return; // no drag physics without a real sheet
    if ((e.target as HTMLElement).closest('button, a, input, textarea, select')) return; // let controls click
    const sheet = sheetRef.current;
    if (!sheet) return;
    stop();
    try {
      sheet.setPointerCapture?.(e.pointerId);
    } catch {
      /* capture is best-effort */
    }
    dragRef.current = {
      startPointerY: e.clientY,
      startY: springRef.current.value,
      history: [{ t: e.timeStamp, y: springRef.current.value }],
    };
  }

  function onPointerMove(e: React.PointerEvent): void {
    const d = dragRef.current;
    if (!d) return;
    const H = heightRef.current || 1;
    let y = d.startY + (e.clientY - d.startPointerY);
    if (y < 0) y = -rubberband(-y, H); // resist past the open position
    springRef.current.reset(y);
    paint(y);
    d.history.push({ t: e.timeStamp, y });
    if (d.history.length > 6) d.history.shift();
  }

  function onPointerUp(): void {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    const H = heightRef.current || 1;
    const first = d.history[0]!;
    const last = d.history[d.history.length - 1]!;
    const dt = (last.t - first.t) / 1000;
    const velocity = dt > 0 ? (last.y - first.y) / dt : 0; // px/s, down positive
    const projected = springRef.current.value + project(velocity);
    const target = nearestSnap(projected, [0, H]);
    springTo(target, velocity, target === H ? () => onCloseRef.current() : undefined);
  }

  if (!mounted) return null;

  return (
    <>
      <div ref={scrimRef} className="tov-scrim" aria-hidden="true" onClick={() => onCloseRef.current()} />
      <div
        ref={sheetRef}
        className="tov-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <span className="tov-sheet__grip" aria-hidden="true" />
        {children}
      </div>
    </>
  );
}
