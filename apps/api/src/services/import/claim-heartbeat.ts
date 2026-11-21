/**
 * [P81-2 · owner, 21 Nov] Keep a note's extraction claim fresh while the work runs. A chat in a bulk import waits on the
 * Message Batches API for minutes per round; the sweep reclaims a claim older than EXTRACTION_CLAIM_TIMEOUT_MS
 * (10 minutes), which would read the chat a second time. A failing touch never fails the work.
 */
export async function withClaimHeartbeat<T>(touch: () => Promise<void>, everyMs: number, work: () => Promise<T>): Promise<T> {
  const timer = setInterval(() => { touch().catch(() => {}); }, everyMs);
  try {
    return await work();
  } finally {
    clearInterval(timer);
  }
}
