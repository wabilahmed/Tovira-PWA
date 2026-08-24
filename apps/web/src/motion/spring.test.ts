import { describe, it, expect } from 'vitest';
import { Spring } from './spring.js';

/** Run a spring to rest (or a cap), returning the trajectory it traced. */
function trace(spring: Spring, { dt = 1 / 60, maxFrames = 2000 } = {}): number[] {
  const path: number[] = [spring.value];
  for (let i = 0; i < maxFrames; i++) {
    const moving = spring.step(dt);
    path.push(spring.value);
    if (!moving) break;
  }
  return path;
}

describe('Spring', () => {
  it('critically damped (damping 1.0) reaches the target WITHOUT overshooting', () => {
    const s = new Spring(0, { damping: 1.0, response: 0.3 });
    s.setTarget(100);
    const path = trace(s);
    expect(Math.max(...path)).toBeLessThanOrEqual(100 + 1e-6); // never past the target
    expect(path.at(-1)).toBeCloseTo(100, 5); // and it does arrive
  });

  it('under-damped (damping 0.6) overshoots and oscillates before settling', () => {
    const s = new Spring(0, { damping: 0.6, response: 0.3 });
    s.setTarget(100);
    const path = trace(s);
    expect(Math.max(...path)).toBeGreaterThan(100); // bounces past
    expect(path.at(-1)).toBeCloseTo(100, 5); // still settles home
  });

  it('settles exactly onto the target and reports done', () => {
    const s = new Spring(0, { damping: 1.0, response: 0.25 });
    s.setTarget(50);
    let moving = true;
    for (let i = 0; i < 2000 && moving; i++) moving = s.step(1 / 60);
    expect(moving).toBe(false);
    expect(s.value).toBe(50);
    expect(s.velocity).toBe(0);
  });

  it('inherits release velocity — a handed-off flick advances faster early on', () => {
    const withVel = new Spring(0, { damping: 1.0, response: 0.4 });
    withVel.setTarget(100, { velocity: 600 });
    const plain = new Spring(0, { damping: 1.0, response: 0.4 });
    plain.setTarget(100);
    // After a few frames the velocity-seeded spring is measurably further along.
    for (let i = 0; i < 6; i++) {
      withVel.step(1 / 60);
      plain.step(1 / 60);
    }
    expect(withVel.value).toBeGreaterThan(plain.value);
  });

  it('is interruptible: re-aiming mid-flight continues from the live value, no jump', () => {
    const s = new Spring(0, { damping: 1.0, response: 0.4 });
    s.setTarget(100);
    for (let i = 0; i < 8; i++) s.step(1 / 60);
    const mid = s.value;
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(100);
    // Reverse the target; the value must keep moving from `mid`, not snap.
    s.setTarget(0);
    const justAfter = s.value;
    expect(justAfter).toBe(mid); // no discontinuity at the re-target
    const path = trace(s);
    expect(path.at(-1)).toBeCloseTo(0, 5); // and it lands on the new target
  });

  it('reset() seeds a position with no residual motion', () => {
    const s = new Spring(0, { damping: 1, response: 0.3 });
    s.setTarget(100);
    for (let i = 0; i < 10; i++) s.step(1 / 60);
    s.reset(42);
    expect(s.value).toBe(42);
    expect(s.target).toBe(42);
    expect(s.velocity).toBe(0);
    expect(s.step(1 / 60)).toBe(false); // nothing to do
  });
});
