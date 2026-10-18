import { describe, it, expect } from 'vitest';
import { resolveDateTime, extractDatePhrase } from './resolve-date.js';

/**
 * [P23-B5 finding] "Second viewing confirmed for Sunday 17/05/2026 at 4pm", sent 7 May, was resolved to
 * 10 May — the weekday matched first and resolved RELATIVE to the message, overriding the explicit date
 * (and the model's correct 17 May). When a phrase names an explicit date, that date wins.
 */
describe('[P23] an explicit date beats a weekday in the same phrase', () => {
  it('"Sunday 17/05/2026 at 4pm" sent 7 May → 17 May 16:00, not the next Sunday (10 May)', () => {
    expect(resolveDateTime('Sunday 17/05/2026 at 4pm', '2026-05-07T09:00', { dayFirst: true }).datetime).toBe('2026-05-17T16:00');
  });
  it('"Saturday 14/03/2026 at 11am" sent 4 Mar → 14 Mar 11:00', () => {
    expect(resolveDateTime('Viewing confirmed for Saturday 14/03/2026 at 11am', '2026-03-04T11:30', { dayFirst: true }).datetime).toBe('2026-03-14T11:00');
  });
  it('ISO beats a weekday too', () => {
    expect(extractDatePhrase('Monday 2026-06-15 at 10am')).toBe('2026-06-15');
  });
  it('NEGATIVE: a weekday alone still resolves relative to its message', () => {
    expect(resolveDateTime('Sunday at 4pm', '2026-05-07T09:00', { dayFirst: true }).datetime).toBe('2026-05-10T16:00');
  });
  it('NEGATIVE: an ambiguous numeric date with no day order proof still resolves to nothing (never a guess)', () => {
    expect(resolveDateTime('Sunday 10/05/2026 at 4pm', '2026-05-07T09:00').datetime).toBeNull();
  });
});
