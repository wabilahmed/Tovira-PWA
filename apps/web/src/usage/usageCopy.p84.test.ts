import { describe, it, expect } from 'vitest';
import { resetDay, usedLine, warnMessage, runOutLine, exhaustedMessage } from './usageCopy.js';

/**
 * [P84-5 / P84-8 · owner, 22 Nov] "Resets <date>" is the rep's own day (their time zone), and a trial reads in trial
 * words: 5,000 trial messages, it ends (it does not reset).
 */
const RESET = '2026-12-01T00:00:00.000Z'; // midnight UTC: still 30 Nov in New York, 1 Dec in Dubai
const sub = { messagesAllowance: 10_000, messagesUsed: 10_000, messagesTotal: 10_000, resetAt: RESET, canTopUp: true, subscription: 'active', messagesExhausted: true, trial: false };
const trial = { messagesAllowance: 5000, messagesUsed: 4000, messagesTotal: 5000, resetAt: '2026-11-30T09:00:00.000Z', canTopUp: false, subscription: 'trialing', messagesExhausted: false, trial: true };

describe('[P84-8] the reset day in the rep\'s own time zone', () => {
  it('New York reads 30 Nov, Dubai reads 1 Dec, for the same reset', () => {
    expect(resetDay(RESET, 'America/New_York')).toBe('30 Nov');
    expect(resetDay(RESET, 'Asia/Dubai')).toBe('1 Dec');
  });
  it('the run-out line and the meter line use it', () => {
    expect(runOutLine({ ...sub, timeZone: 'America/New_York' })).toBe("You've read your 10,000 messages this month. Resets 30 Nov.");
    expect(usedLine({ ...sub, messagesUsed: 2340, timeZone: 'America/New_York' })).toBe('2,340 of 10,000 messages read this month · resets 30 Nov');
  });
  it('NEGATIVE: no time zone known: the UTC day, as before', () => {
    expect(resetDay(RESET, null)).toBe('1 Dec');
    expect(resetDay(RESET, 'Not/AZone')).toBe('1 Dec');
  });
});

describe('[P84-5] a trial in trial words', () => {
  it('the meter: "4,000 of 5,000 trial messages read · trial ends 30 Nov"', () => {
    expect(usedLine({ ...trial, timeZone: 'Asia/Dubai' })).toBe('4,000 of 5,000 trial messages read · trial ends 30 Nov');
  });
  it('the 80% line', () => {
    expect(warnMessage(trial)).toBe("You've read 4,000 of your 5,000 trial messages.");
  });
  it('run out: subscribe', () => {
    expect(exhaustedMessage({ ...trial, messagesExhausted: true })).toBe("You've read your 5,000 trial messages. Subscribe to keep importing.");
  });
  it('NEGATIVE: a subscriber\'s lines are unchanged', () => {
    expect(warnMessage({ ...sub, messagesUsed: 8000 })).toBe("You've read 8,000 of your 10,000 messages this month.");
  });
});
