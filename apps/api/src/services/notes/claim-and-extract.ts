/**
 * [BULK-IMPORT · RULING 2 items 2/5/6] The ONE path that drains a note for extraction — used by BOTH
 * the background sweep and the bulk orchestrator.
 *
 * It first CLAIMS the note atomically (pending_extraction → extracting). Only the winner of the claim
 * extracts, so the two drainers racing the same queue never double-extract a note (item 2). A claimed
 * note is now 'extracting' — a STARTED chat — so its extraction runs with forceAllowance: once started
 * it always finishes, and the gate absorbs any overshoot (item 6). This is the SINGLE call site that
 * sets forceAllowance; the lockdown guard (item 5) enforces that nothing else does.
 */
import type { ExtractOutcome } from '../extraction/extraction-service.js';

export interface ClaimAndExtractDeps {
  /** Atomic claim: pending_extraction → extracting. True iff this caller won it. */
  claim: (userId: string, noteId: string, nowMs: number) => Promise<boolean>;
  /** The certified extraction. Called ONLY after a successful claim — so the note is already
   *  'extracting' when forceAllowance is passed (item 5b holds by construction). */
  extract: (userId: string, noteId: string, today: string, opts?: { forceAllowance?: boolean }) => Promise<ExtractOutcome>;
  now?: () => number;
}

export function createClaimAndExtract(deps: ClaimAndExtractDeps) {
  const now = deps.now ?? ((): number => Date.now());
  return async function claimAndExtract(userId: string, noteId: string, today: string): Promise<ExtractOutcome> {
    const claimed = await deps.claim(userId, noteId, now());
    if (!claimed) return { status: 'claimed_elsewhere' }; // another worker has it — do nothing
    return deps.extract(userId, noteId, today, { forceAllowance: true });
  };
}
