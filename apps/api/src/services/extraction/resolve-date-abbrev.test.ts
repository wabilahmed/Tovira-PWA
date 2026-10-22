import { describe, it, expect } from 'vitest';
import { resolveDueDate, resolveDateTime } from './resolve-date.js';

/** [P40-1] With the model's date never used, the resolver reads the short weekday forms reps actually type. */
const THU = '2026-07-09T09:00'; // a Thursday
describe('[P40-1] weekday abbreviations', () => {
  it.each([['Fri', '2026-07-10'], ['fri', '2026-07-10'], ['Mon', '2026-07-13'], ['Tue', '2026-07-14'], ['Tues', '2026-07-14'], ['Wed', '2026-07-15'], ['Thu', '2026-07-16'], ['Thurs', '2026-07-16'], ['Sat', '2026-07-11'], ['Sun', '2026-07-12']])('%s → %s', (raw, d) => {
    expect(resolveDueDate(raw, THU).date).toBe(d);
  });
  it('"meeting with Meridian Fri 10am" → Friday 10:00', () => {
    expect(resolveDateTime('meeting with Meridian Fri 10am', THU).datetime).toBe('2026-07-10T10:00');
  });
  it('negative: "next Tue" stays unresolved; a word merely starting with the letters is not a day', () => {
    expect(resolveDueDate('next Tue', THU).date).toBeNull();
    expect(resolveDateTime('meeting at the Sunset Mall 3pm', THU).datetime).toBeNull();
  });
});
