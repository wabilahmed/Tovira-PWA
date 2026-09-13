/**
 * [PRIVACY-4] The k-anonymity floor for cross-account behavioural aggregates.
 *
 * No aggregation feature exists yet. This module is the ONE sanctioned gate that any future
 * cross-account aggregate (a metric computed across more than one rep's accounts — e.g. "reps who do
 * X close Y% more") MUST call before it is computed or surfaced. It exists now so the rule is written
 * down and testable before the first aggregate is built, not bolted on after.
 *
 * The floor guarantees an aggregate reflects at least MIN_AGGREGATE_GROUP_SIZE distinct accounts, so
 * no single rep's behaviour can be re-identified from the published number.
 */

/**
 * Minimum number of distinct accounts a cross-account aggregate must span.
 *
 * Derivation (NOT settled — the owner sets the final number, and any published aggregate/policy must
 * honour whatever the code says): a standard k-anonymity floor. k = 5 is the common minimum at which a
 * group statistic stops being attributable to one member. With a small pilot population the owner may
 * raise it (10+) for a stronger guarantee; it is deliberately a single constant so that decision is
 * one edit. It is never lowered silently — this is a privacy property, not a tuning knob.
 */
export const MIN_AGGREGATE_GROUP_SIZE = 5;

/** Thrown when an aggregate would span fewer than MIN_AGGREGATE_GROUP_SIZE accounts. */
export class AggregateGroupTooSmallError extends Error {
  constructor(public readonly groupSize: number) {
    super(
      `Aggregate refused: a cross-account aggregate must span at least ${MIN_AGGREGATE_GROUP_SIZE} accounts, got ${groupSize}. ` +
        `Surfacing a smaller group risks re-identifying one rep's behaviour.`,
    );
    this.name = 'AggregateGroupTooSmallError';
  }
}

/**
 * The single sanctioned gate. Call it with the number of distinct accounts an aggregate spans BEFORE
 * computing or returning it; it throws if the group is too small (or a nonsensical size), and is a
 * no-op when the group is large enough. Every future cross-account aggregate routes through here — do
 * not re-implement the comparison inline anywhere else.
 */
export function assertAggregateAllowed(groupSize: number): void {
  if (!Number.isInteger(groupSize) || groupSize < 0) {
    throw new AggregateGroupTooSmallError(groupSize);
  }
  if (groupSize < MIN_AGGREGATE_GROUP_SIZE) {
    throw new AggregateGroupTooSmallError(groupSize);
  }
}
