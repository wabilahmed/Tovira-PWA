/**
 * [P90-1 · owner, Prompt 88] A failed load must never look like an empty account. A client's "…Result" read answers
 * LOAD_FAILED when the request did not come back (offline, a server error, any unexpected status), so the screen can
 * show an error with "Try again" instead of its empty state. A 402 is not a failure: it is the server saying the
 * feature is paused or locked, which each screen already explains.
 */
export const LOAD_FAILED = 'load_failed' as const;
export type LoadFailed = typeof LOAD_FAILED;
export const isLoadFailure = (status: number): boolean => status !== 200 && status !== 402;

/** GET `url` and pick the body; LOAD_FAILED when it did not come back; `paused` on a 402. */
export async function loadJson<T>(url: string, pick: (body: unknown) => T, paused: T): Promise<T | LoadFailed> {
  try {
    const res = await fetch(url, { credentials: 'include' });
    if (res.status === 402) return paused;
    if (res.status !== 200) return LOAD_FAILED;
    return pick(await res.json());
  } catch {
    return LOAD_FAILED;
  }
}
