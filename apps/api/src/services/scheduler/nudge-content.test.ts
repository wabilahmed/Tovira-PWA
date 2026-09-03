import { describe, it, expect } from 'vitest';
import { composeNudgeContent, formatMeetingWhen, type NudgeSignals } from './nudge-content.js';

const base: NudgeSignals = { clientName: 'Meridian', clientId: 'c1', whenLabel: 'today at 3:00 PM' };

describe('[NUDGE-CONTENT] the nudge carries the single most actionable item', () => {
  it('prefers an open promise over a question and a cooling signal', () => {
    const c = composeNudgeContent({ ...base, topPromise: 'send the revised quote', topQuestion: 'did they get the floor plans', silentDays: 40 });
    expect(c.body).toContain('Open promise');
    expect(c.body).toContain('send the revised quote');
    expect(c.body).not.toContain('Unanswered');
    expect(c.body).not.toContain('quiet');
  });

  it('falls to an unanswered question when there is no open promise', () => {
    const c = composeNudgeContent({ ...base, topQuestion: 'are they still deciding this month', silentDays: 40 });
    expect(c.body).toContain('Unanswered');
    expect(c.body).toContain('are they still deciding this month');
    expect(c.body).not.toContain('quiet');
  });

  it('falls to the cooling signal when there is neither promise nor question', () => {
    const c = composeNudgeContent({ ...base, silentDays: 40 });
    expect(c.body).toContain('silent 40 days');
  });

  it('a thin but HONEST nudge when nothing is substantive: meeting details only, nothing invented', () => {
    const c = composeNudgeContent({ ...base });
    expect(c.title).toBe('Meridian');
    expect(c.body).toBe('today at 3:00 PM'); // just the time — no fabricated item
    // silentDays 0 / undefined is not a cooling signal
    expect(composeNudgeContent({ ...base, silentDays: 0 }).body).toBe('today at 3:00 PM');
  });

  it('always includes client name + time, and a deep link to that client', () => {
    const c = composeNudgeContent({ ...base, topPromise: 'call them back' });
    expect(c.title).toBe('Meridian');
    expect(c.body.startsWith('today at 3:00 PM · ')).toBe(true);
    expect(c.url).toBe('/app?client=c1');
  });

  it('formatMeetingWhen renders the meeting on the rep\'s clock with a relative day', () => {
    const tz = 'Asia/Dubai';
    const now = Date.parse('2026-07-09T09:00:00Z'); // 13:00 Dubai on the 9th
    const at3pmDubai = Date.parse('2026-07-09T11:00:00Z'); // 15:00 Dubai, same day
    expect(formatMeetingWhen(at3pmDubai, tz, now)).toBe('today at 3:00 PM');
    const tomorrow = Date.parse('2026-07-10T05:30:00Z'); // 09:30 Dubai next day
    expect(formatMeetingWhen(tomorrow, tz, now)).toBe('tomorrow at 9:30 AM');
    const later = Date.parse('2026-07-15T11:00:00Z'); // 15:00 Dubai, the 15th
    expect(formatMeetingWhen(later, tz, now)).toBe('15 Jul at 3:00 PM');
  });

  it('brand: the framing copy has no exclamation marks and no emoji; long text is clipped', () => {
    const long = 'x'.repeat(400);
    const c = composeNudgeContent({ ...base, topPromise: long });
    expect(c.title + c.body).not.toMatch(/!/);
    // no emoji (surrogate pairs / pictographs) in our framing
    expect('Open promise — Unanswered — Going quiet — silent days').not.toMatch(/\p{Extended_Pictographic}/u);
    expect(c.body.length).toBeLessThan(160); // clipped, not the full 400 chars
  });
});
