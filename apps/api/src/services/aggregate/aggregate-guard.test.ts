import { describe, it, expect } from 'vitest';
import { assertAggregateAllowed, MIN_AGGREGATE_GROUP_SIZE, AggregateGroupTooSmallError } from './aggregate-guard.js';

// [PRIVACY-4] The k-anonymity floor for ANY future cross-account behavioural aggregate. No aggregation
// is built yet; this is the single sanctioned gate every future aggregate must pass through, so a
// group smaller than the floor can never be surfaced (it could re-identify one rep's behaviour).
describe('[PRIVACY-4] aggregate group-size floor', () => {
  it('throws below the floor', () => {
    expect(() => assertAggregateAllowed(MIN_AGGREGATE_GROUP_SIZE - 1)).toThrow(AggregateGroupTooSmallError);
  });

  it('passes exactly at the floor', () => {
    expect(() => assertAggregateAllowed(MIN_AGGREGATE_GROUP_SIZE)).not.toThrow();
  });

  it('passes above the floor', () => {
    expect(() => assertAggregateAllowed(MIN_AGGREGATE_GROUP_SIZE + 10)).not.toThrow();
  });

  it('rejects a nonsensical group size (negative / non-integer) rather than silently allowing it', () => {
    expect(() => assertAggregateAllowed(-1)).toThrow();
    expect(() => assertAggregateAllowed(4.5)).toThrow();
  });
});
