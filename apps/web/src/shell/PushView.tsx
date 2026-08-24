import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { Spring, runSpring } from '../motion/spring.js';
import { project, rubberband, nearestSnap } from '../motion/projection.js';
import { usePrefersReducedMotion } from '../motion/prefers.js';

/** A calm push — a faint settle, no showy bounce. */
const PUSH_SPRING = { damping: 0.9, response: 0.4 } as const;
/** Only a pointer-down within this many px of the left edge starts a back-swipe. */
const EDGE = 28;

interface DragState {
  startPointerX: number;
  startX: number;
  history: { t: number; x: number }[];
}

/**
 * A full-screen push (the sheet's physics, rotated to X): the detail slides in
 * from the right on mount and dismisses back to the right — enter and exit along
 * the SAME path (apple-design §7 spatial consistency). A left-edge swipe drags it
 * 1:1, rubber-bands past the open bound (§9), and on release PROJECTS the flick
 * to snap open or dismissed, handing the velocity to the spring (§5,§6).
 *
 * `children` is a render-prop given `dismiss(after?)`: it animates out, then runs
 * `onDismiss` and any follow-up (e.g. navigate onward). Under reduced motion, or
 * where there's no measured width (jsdom), it mounts and dismisses instantly, so
 * the pushed content is always in the DOM synchronously for its consumers.
 */
export function PushView({
  onDismiss,
  children,
}: {
  onDismiss: () => void;
  children: (dismiss: (after?: () => void) => void) => ReactNode;
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const spring = useRef(new Spring(0, PUSH_SPRING)).current;
  const stopRef = useRef<(() => void) | null>(null);
  const widthRef = useRef(1);
  const dragRef = useRef<DragState | null>(null);
  const reduced = usePrefersReducedMotion();
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  const stop = useCallback(() => {
    stopRef.current?.();
    stopRef.current = null;
  }, []);

  const paint = useCallback((x: number) => {
    if (ref.current) ref.current.style.transform = `translateX(${x}px)`;
  }, []);

  const springTo = useCallback(
    (target: number, velocity: number | undefined, onRest?: () => void) => {
      stop();
      spring.setTarget(target, velocity !== undefined ? { velocity } : undefined);
      stopRef.current = runSpring(spring, paint, () => {
        stopRef.current = null;
        onRest?.();
      });
    },
    [paint, spring, stop],
  );

  // Mount → slide in from the right (or place instantly where there's no width).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.getBoundingClientRect().width;
    if (reduced || w <= 0) {
      widthRef.current = Math.max(w, 1);
      spring.reset(0);
      paint(0);
      return;
    }
    widthRef.current = w;
    spring.reset(w);
    paint(w);
    springTo(0, undefined);
    return () => stop();
  }, [paint, reduced, spring, springTo, stop]);

  useEffect(() => () => stop(), [stop]);

  const dismiss = useCallback(
    (after?: () => void, velocity?: number) => {
      const done = (): void => {
        onDismissRef.current();
        after?.();
      };
      const w = widthRef.current;
      if (reduced || w <= 1) {
        done();
        return;
      }
      springTo(w, velocity, done);
    },
    [reduced, springTo],
  );

  function onPointerDown(e: React.PointerEvent): void {
    if (reduced || widthRef.current <= 1) return;
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (e.clientX - rect.left > EDGE) return; // back-swipe starts at the left edge only
    if ((e.target as HTMLElement).closest('button, a, input, textarea, select')) return;
    stop();
    try {
      el.setPointerCapture?.(e.pointerId);
    } catch {
      /* best-effort */
    }
    dragRef.current = { startPointerX: e.clientX, startX: spring.value, history: [{ t: e.timeStamp, x: spring.value }] };
  }

  function onPointerMove(e: React.PointerEvent): void {
    const d = dragRef.current;
    if (!d) return;
    const w = widthRef.current || 1;
    let x = d.startX + (e.clientX - d.startPointerX);
    if (x < 0) x = -rubberband(-x, w); // resist past the fully-open edge
    spring.reset(x);
    paint(x);
    d.history.push({ t: e.timeStamp, x });
    if (d.history.length > 6) d.history.shift();
  }

  function onPointerUp(): void {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    const w = widthRef.current || 1;
    const first = d.history[0]!;
    const last = d.history[d.history.length - 1]!;
    const dt = (last.t - first.t) / 1000;
    const velocity = dt > 0 ? (last.x - first.x) / dt : 0;
    const projected = spring.value + project(velocity);
    const target = nearestSnap(projected, [0, w]);
    if (target === w) dismiss(undefined, velocity);
    else springTo(0, velocity);
  }

  return (
    <div
      ref={ref}
      className="tov-push"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {children(dismiss)}
    </div>
  );
}
