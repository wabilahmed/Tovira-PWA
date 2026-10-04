import { describe, it, expect } from 'vitest';
import { estimateBulkAed, percentOfAllowance } from './bulk-estimate.js';

describe('[BULK-IMPORT] up-front allowance estimate', () => {
  it('estimates a worst-case cost that grows with the number and size of chats', () => {
    const one = estimateBulkAed(['short chat'], 'claude-sonnet-5');
    const many = estimateBulkAed(['short chat', 'short chat', 'short chat'], 'claude-sonnet-5');
    const bigger = estimateBulkAed(['short chat'.repeat(500)], 'claude-sonnet-5');
    expect(one).toBeGreaterThan(0);
    expect(many).toBeGreaterThan(one); // more chats → more cost
    expect(bigger).toBeGreaterThan(one); // a longer chat → more cost
    expect(estimateBulkAed([], 'claude-sonnet-5')).toBe(0); // nothing to import → no cost
  });

  it('is a sum of independent per-chat ceilings (one call per chat, D1)', () => {
    const a = estimateBulkAed(['alpha'], 'claude-sonnet-5');
    const b = estimateBulkAed(['beta beta'], 'claude-sonnet-5');
    const both = estimateBulkAed(['alpha', 'beta beta'], 'claude-sonnet-5');
    expect(both).toBeCloseTo(a + b, 6);
  });

  it('expresses the estimate as a percentage of the period allowance', () => {
    expect(percentOfAllowance(9, 45)).toBe(20);
    expect(percentOfAllowance(45, 45)).toBe(100);
    expect(percentOfAllowance(90, 45)).toBe(200); // a batch that would exceed the allowance reads >100%
    expect(percentOfAllowance(5, 0)).toBe(Infinity); // no allowance configured/left
  });
});
