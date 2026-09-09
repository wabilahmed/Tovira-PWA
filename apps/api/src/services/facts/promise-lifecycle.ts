/**
 * [PROMISE-STALE] The promise lifecycle by AGE — a SURFACING rule, never an extraction rule.
 *
 * Extraction continues to capture every promise regardless of age: the Book Scan's headline IS an old
 * dropped promise ("you told Sarah you'd send the revised quote on the 12th — there's no sign you
 * did"), and recall/search/export must retain them all. Complete vault, sensible foreground.
 *
 * A promise is ACTIVE while it is future-dated or overdue within the recoverable window; once overdue
 * by MORE than the window it is STALE — still stored, still searchable, still answerable by recall,
 * shown behind a filter, but out of the active count, out of claret, off Today's register.
 *
 * Threshold: 90 days overdue (configurable via PROMISE_STALE_THRESHOLD_DAYS). Derivation: a promise
 * dropped six weeks ago is very much recoverable and is exactly what the Book Scan sells; a promise
 * from years ago is dead. 30 days would gut the feature to solve a problem that only really exists at
 * the multi-year (import) end. 90 keeps recent misses actionable while retiring the truly ancient.
 * [flag] the owner may set this to 30 if preferred — it is a single config value.
 *
 * Doctrine sibling: requirement 60-day dormancy and disabled inventory — never deleted, just retired
 * from the active surface. Unlike those (a stored status), staleness is a COMPUTED predicate, because
 * the spec is surfacing-only: the promise is unchanged in storage, so an imported historical promise
 * is stale by computation the moment it lands (the import-flood case) without any migration.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export interface AgeablePromise {
  done: boolean;
  dueDate: string | null;
}

/** Overdue by MORE than the window. Done or undated → never stale (undated has no overdue date to age).
 *  Day-granular: both due_date and today are anchored to UTC midnight, so "N days overdue" is a whole
 *  number and the threshold boundary is exact (90 days overdue is not yet stale; 91 is) — no dependence
 *  on the time of day the check runs. */
export function isStalePromise(p: AgeablePromise, nowMs: number, thresholdDays: number): boolean {
  if (p.done || p.dueDate === null) return false;
  const dueMs = Date.parse(`${p.dueDate}T00:00:00Z`);
  if (Number.isNaN(dueMs)) return false;
  const todayMs = Date.parse(`${new Date(nowMs).toISOString().slice(0, 10)}T00:00:00Z`);
  return todayMs - dueMs > thresholdDays * DAY_MS;
}

/** The foreground set: open (not done) AND not stale — what the active count, claret, and Today's
 *  register are allowed to show. */
export function isActivePromise(p: AgeablePromise, nowMs: number, thresholdDays: number): boolean {
  return !p.done && !isStalePromise(p, nowMs, thresholdDays);
}
