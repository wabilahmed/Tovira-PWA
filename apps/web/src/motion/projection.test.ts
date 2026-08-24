import { describe, it, expect } from 'vitest';
import { project, rubberband, nearestSnap } from './projection.js';

describe('project (momentum endpoint)', () => {
  it('projects further the faster the flick', () => {
    expect(project(1000)).toBeGreaterThan(project(200));
  });

  it('is signed — a downward flick projects downward', () => {
    expect(project(-800)).toBeLessThan(0);
    expect(project(800)).toBeGreaterThan(0);
  });

  it('matches the exponential-decay model (v/1000 · d/(1-d))', () => {
    // 500 px/s at the default 0.998 rate.
    const expected = (500 / 1000) * (0.998 / (1 - 0.998));
    expect(project(500)).toBeCloseTo(expected, 6);
    expect(project(500)).toBeCloseTo(249.5, 3);
  });

  it('a snappier deceleration rate coasts less far', () => {
    expect(project(500, 0.99)).toBeLessThan(project(500, 0.998));
  });
});

describe('rubberband (boundary resistance)', () => {
  it('follows less than the raw overshoot (resists)', () => {
    expect(rubberband(100, 800)).toBeLessThan(100);
    expect(rubberband(100, 800)).toBeGreaterThan(0);
  });

  it('resists progressively — proportionally less as the drag goes further', () => {
    const near = rubberband(50, 800);
    const far = rubberband(400, 800);
    expect(far).toBeGreaterThan(near); // still moves further…
    expect(far / 400).toBeLessThan(near / 50); // …but a smaller fraction of the drag
  });

  it('is signed and symmetric', () => {
    expect(rubberband(-100, 800)).toBeCloseTo(-rubberband(100, 800), 10);
  });
});

describe('nearestSnap', () => {
  it('picks the closest snap point to the projected endpoint', () => {
    expect(nearestSnap(120, [0, 400])).toBe(0);
    expect(nearestSnap(260, [0, 400])).toBe(400);
  });
});
