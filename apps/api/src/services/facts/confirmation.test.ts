import { describe, it, expect } from 'vitest';
import {
  promiseNeedsConfirmation,
  isActionableForReminder,
  presentableAsSettledFact,
  pendingConfirmations,
} from './confirmation.js';
import type { PromiseRecord } from '../../ports/facts-repository.js';

const base = { confirmed: false, confidence: 'high', dueRaw: null as string | null, dueDate: null as string | null };

describe('confirmation rules', () => {
  it('flags a low-confidence promise for confirmation', () => {
    expect(promiseNeedsConfirmation({ ...base, confidence: 'low' })).toBe(true);
  });

  it('flags an unresolved date (due_raw present, due_date null)', () => {
    expect(promiseNeedsConfirmation({ ...base, dueRaw: 'end of next week', dueDate: null })).toBe(true);
  });

  it('does not flag a high-confidence, resolved promise', () => {
    expect(promiseNeedsConfirmation({ ...base, dueRaw: 'Friday', dueDate: '2026-07-10' })).toBe(false);
  });

  it('stops flagging once confirmed', () => {
    expect(promiseNeedsConfirmation({ ...base, confidence: 'low', confirmed: true })).toBe(false);
  });

  // NEGATIVE: an unconfirmed uncertain item must never fire an alert/reminder…
  it('is not actionable for a reminder while awaiting confirmation', () => {
    expect(isActionableForReminder({ ...base, confidence: 'low' })).toBe(false);
    expect(isActionableForReminder({ ...base, dueRaw: 'soon', dueDate: null })).toBe(false);
  });

  it('becomes actionable once confirmed', () => {
    expect(isActionableForReminder({ ...base, confidence: 'low', confirmed: true })).toBe(true);
  });

  // …nor be shown as a settled fact.
  it('is not presentable as a settled fact while awaiting confirmation', () => {
    expect(presentableAsSettledFact({ ...base, confidence: 'low' })).toBe(false);
  });

  it('collects the confirmation queue', () => {
    const promises = [
      { confidence: 'low', dueRaw: null, dueDate: null, confirmed: false },
      { confidence: 'high', dueRaw: 'Friday', dueDate: '2026-07-10', confirmed: false },
    ] as PromiseRecord[];
    expect(pendingConfirmations(promises)).toHaveLength(1);
  });
});
