import type { PromiseRecord } from '../../ports/facts-repository.js';

/**
 * The trust rules for uncertain facts (P1-7). A promise needs the rep to confirm
 * it when its ownership/wording is uncertain (confidence "low") OR its date
 * couldn't be resolved (a due_raw phrase with no due_date). Until confirmed, such
 * an item must NEVER drive an alert/reminder or be shown as a settled fact.
 */

export interface ConfirmablePromise {
  confidence: string;
  dueRaw: string | null;
  dueDate: string | null;
  confirmed: boolean;
}

export function promiseNeedsConfirmation(p: ConfirmablePromise): boolean {
  if (p.confirmed) return false;
  if (p.confidence === 'low') return true;
  if (p.dueRaw !== null && p.dueDate === null) return true; // unresolved relative date
  return false;
}

/** A promise may only drive a reminder/alert if it is NOT awaiting confirmation. */
export function isActionableForReminder(p: ConfirmablePromise): boolean {
  return !promiseNeedsConfirmation(p);
}

/** The brief may only present a promise as a settled fact once it's confirmed/certain. */
export function presentableAsSettledFact(p: ConfirmablePromise): boolean {
  return !promiseNeedsConfirmation(p);
}

/** The confirmation queue: everything the rep still needs to confirm. */
export function pendingConfirmations(promises: PromiseRecord[]): PromiseRecord[] {
  return promises.filter(promiseNeedsConfirmation);
}
