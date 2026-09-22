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
 * Derivation: SET TO MATCH THE PUBLISHED PRIVACY POLICY. Section 8 of the privacy policy states we
 * never compute or retain a statistic from a group of fewer than 20 reps or clients, so the code floor
 * IS 20 — the policy sentence and this constant must always agree. A standard k-anonymity floor is
 * k = 5; the owner chose the stronger 20 for the pilot population, and the policy promises it, so the
 * two are bound together. It is never lowered silently — that would make a published promise false;
 * this is a privacy property, not a tuning knob. (A test pins it to 20 so a silent change fails CI.)
 */
export const MIN_AGGREGATE_GROUP_SIZE = 20;

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
