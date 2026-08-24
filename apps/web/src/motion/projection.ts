/**
 * Momentum + boundary math for gesture handoff (Designing Fluid Interfaces).
 * Kept pure so it can be unit-tested against Apple's own sample values.
 */

/**
 * Where a flick would coast to rest, given its release velocity — the same
 * exponential-decay model as scroll deceleration (NOT the textbook v²/2a).
 * Snap to the target nearest this projected point so a small flick throws the
 * element the way the finger implied.
 *
 * @param initialVelocity px/s at release
 * @param decelerationRate 0.998 ≈ normal scroll feel; 0.99 = snappier
 */
export function project(initialVelocity: number, decelerationRate = 0.998): number {
  return ((initialVelocity / 1000) * decelerationRate) / (1 - decelerationRate);
}

/**
 * Progressive resistance past a boundary — real things slow before they stop, so
 * the further past the edge the finger drags, the less the element follows. A
 * hard stop reads as "frozen"; this reads as "responsive, but there's no more".
 *
 * @param overshoot how far past the bound the finger has dragged (px)
 * @param dimension the size the resistance is scaled against (px)
 */
export function rubberband(overshoot: number, dimension: number, constant = 0.55): number {
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

/** The snap point nearest `value` (e.g. the projected endpoint). */
export function nearestSnap(value: number, points: readonly number[]): number {
  return points.reduce((best, p) => (Math.abs(p - value) < Math.abs(best - value) ? p : best));
}
