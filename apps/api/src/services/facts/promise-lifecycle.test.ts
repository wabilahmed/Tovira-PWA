import { describe, it, expect } from 'vitest';
import { isStalePromise, isActivePromise } from './promise-lifecycle.js';

const NOW = Date.parse('2026-09-09T12:00:00Z');
const daysAgo = (n: number): string => new Date(NOW - n * 86_400_000).toISOString().slice(0, 10);
const inDays = (n: number): string => new Date(NOW + n * 86_400_000).toISOString().slice(0, 10);

describe('[PROMISE-STALE] promise staleness — a surfacing rule, not an extraction rule', () => {
  it('a promise overdue beyond the window is STALE', () => {
    expect(isStalePromise({ done: false, dueDate: daysAgo(200) }, NOW, 90)).toBe(true);
  });

  it('a promise overdue WITHIN the window is NOT stale (recoverable — the Book Scan headline)', () => {
    expect(isStalePromise({ done: false, dueDate: daysAgo(42) }, NOW, 90)).toBe(false);
  });

  it('a promise exactly at the threshold is not yet stale (strictly greater than)', () => {
    expect(isStalePromise({ done: false, dueDate: daysAgo(90) }, NOW, 90)).toBe(false);
    expect(isStalePromise({ done: false, dueDate: daysAgo(91) }, NOW, 90)).toBe(true);
  });

  it('a future-dated promise is never stale', () => {
    expect(isStalePromise({ done: false, dueDate: inDays(10) }, NOW, 90)).toBe(false);
  });

  it('a DONE promise is never stale, however overdue (it left the active set by being kept)', () => {
    expect(isStalePromise({ done: true, dueDate: daysAgo(999) }, NOW, 90)).toBe(false);
  });

  it('an UNDATED promise is never stale — staleness is about an overdue date, which it has none of', () => {
    expect(isStalePromise({ done: false, dueDate: null }, NOW, 90)).toBe(false);
  });

  it('honours a configurable threshold (30 vs 90)', () => {
    const p = { done: false, dueDate: daysAgo(45) };
    expect(isStalePromise(p, NOW, 90)).toBe(false);
    expect(isStalePromise(p, NOW, 30)).toBe(true); // owner may prefer 30
  });

  it('active = open AND not stale (the foreground: count, claret, Today\'s register)', () => {
    expect(isActivePromise({ done: false, dueDate: daysAgo(10) }, NOW, 90)).toBe(true);  // recoverable overdue
    expect(isActivePromise({ done: false, dueDate: inDays(5) }, NOW, 90)).toBe(true);    // future
    expect(isActivePromise({ done: false, dueDate: daysAgo(200) }, NOW, 90)).toBe(false); // stale
    expect(isActivePromise({ done: true, dueDate: inDays(5) }, NOW, 90)).toBe(false);     // done is not active-open
  });
});
