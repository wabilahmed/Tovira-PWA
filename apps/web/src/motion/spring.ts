/**
 * A dependency-free spring, in Apple's two designer knobs (Designing Fluid
 * Interfaces, WWDC 2018), translated to the web.
 *
 *  - `damping`  — the damping ratio. 1 = critically damped (settles, no bounce);
 *                 < 1 overshoots and oscillates (lower = bouncier).
 *  - `response` — roughly how long the value takes to reach the target, in
 *                 seconds. NOT a fixed duration: a spring has none; its settle
 *                 time emerges from the parameters.
 *
 * The whole point of a spring over a scripted tween is that it is interruptible
 * and velocity-aware: `setTarget` re-aims from the LIVE value and can inherit the
 * gesture's release velocity, so a grabbed, reversed, or re-thrown element never
 * jumps or hits a "brick wall". Integrate it on rAF via `runSpring`.
 */
export interface SpringParams {
  /** Damping ratio: 1 = critical (no overshoot), < 1 = bounce. */
  damping: number;
  /** Approximate time-to-target, seconds. Lower = snappier. */
  response: number;
}

export interface RetargetOpts {
  /** Hand the spring a starting velocity (px/s) — the gesture's release speed. */
  velocity?: number;
}

const EPSILON_VALUE = 0.01;
const EPSILON_VELOCITY = 0.05;
const MAX_SUBSTEP = 1 / 240; // integrate finely for stability at large frame gaps

export class Spring {
  value: number;
  velocity = 0;
  target: number;
  private damping: number;
  private response: number;

  constructor(initial: number, params: SpringParams) {
    this.value = initial;
    this.target = initial;
    this.damping = params.damping;
    this.response = params.response;
  }

  /** Re-aim from the current value; optionally inherit a release velocity. */
  setTarget(target: number, opts?: RetargetOpts): void {
    this.target = target;
    if (opts?.velocity !== undefined) this.velocity = opts.velocity;
  }

  /** Snap to a value with no motion (e.g. seeding a drag from the live position). */
  reset(value: number, velocity = 0): void {
    this.value = value;
    this.target = value;
    this.velocity = velocity;
  }

  /**
   * Advance by `dt` seconds. Returns true while still moving, false once it has
   * settled (at which point it is snapped exactly onto the target).
   */
  step(dt: number): boolean {
    const omega = (2 * Math.PI) / this.response; // natural angular frequency
    const k = omega * omega; // stiffness (unit mass)
    const c = 2 * this.damping * omega; // damping coefficient

    const substeps = Math.max(1, Math.ceil(dt / MAX_SUBSTEP));
    const h = dt / substeps;
    for (let i = 0; i < substeps; i++) {
      // Semi-implicit Euler: update velocity from the force, then position.
      const force = -k * (this.value - this.target) - c * this.velocity;
      this.velocity += force * h;
      this.value += this.velocity * h;
    }

    if (Math.abs(this.value - this.target) < EPSILON_VALUE && Math.abs(this.velocity) < EPSILON_VELOCITY) {
      this.value = this.target;
      this.velocity = 0;
      return false;
    }
    return true;
  }
}

/**
 * Drive a spring on the display-synced clock (rAF is the web's CADisplayLink).
 * Uses the rAF timestamp for dt (clamped, so a backgrounded tab doesn't explode
 * on return), calls `onFrame` every frame with the live value, and `onRest` once.
 * Returns a stop() that cancels the loop. No-ops safely where rAF is absent.
 */
export function runSpring(
  spring: Spring,
  onFrame: (value: number) => void,
  onRest?: () => void,
): () => void {
  if (typeof requestAnimationFrame !== 'function') {
    // No display clock (SSR): jump to rest so nothing is left mid-transition.
    spring.value = spring.target;
    spring.velocity = 0;
    onFrame(spring.value);
    onRest?.();
    return () => {};
  }

  let raf = 0;
  let last = 0;
  let stopped = false;

  const tick = (t: number): void => {
    if (stopped) return;
    const dt = last ? Math.min((t - last) / 1000, 1 / 30) : 1 / 60;
    last = t;
    const moving = spring.step(dt);
    onFrame(spring.value);
    if (moving) {
      raf = requestAnimationFrame(tick);
    } else {
      onRest?.();
    }
  };

  raf = requestAnimationFrame(tick);
  return () => {
    stopped = true;
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
  };
}
