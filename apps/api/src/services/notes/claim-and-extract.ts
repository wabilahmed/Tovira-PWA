/**
 * [BULK-IMPORT · RULING 2 items 2/5/6] The ONE path that drains a note for extraction — used by BOTH
 * the background sweep and the bulk orchestrator.
 *
 * It first CLAIMS the note atomically (pending_extraction → extracting). Only the winner of the claim
 * extracts, so the two drainers racing the same queue never double-extract a note (item 2).
 *
 * [P79-EMERGENCY · owner, 19 Nov] "Remove the allowance exemption for chats that have started." A started chat used to
 * run with forceAllowance (it always finished, past the cap); a 28,357-message chat then ran for hours past the
 * AED 45 cap. Now nothing passes forceAllowance: a chat that reaches the cap stops at its next model call and waits.
 * And a note over the emergency limit (`tooLong`) is never claimed or read: it is set to needs_review, no model call.
 */
import type { ExtractOutcome } from '../extraction/extraction-service.js';

export interface ClaimAndExtractDeps {
  /** Atomic claim: pending_extraction → extracting. True iff this caller won it. */
  claim: (userId: string, noteId: string, nowMs: number) => Promise<boolean>;
  /** The certified extraction. Called ONLY after a successful claim — so the note is already
   *  'extracting' when forceAllowance is passed (item 5b holds by construction). */
  extract: (userId: string, noteId: string, today: string, opts?: { forceAllowance?: boolean }) => Promise<ExtractOutcome>;
  now?: () => number;
  /** [P79-EMERGENCY] True when the note has more messages than may be read; it is then set aside, never read. */
  tooLong?: (userId: string, noteId: string) => Promise<boolean>;
  setAside?: (userId: string, noteId: string) => Promise<void>;
}

export function createClaimAndExtract(deps: ClaimAndExtractDeps) {
  const now = deps.now ?? ((): number => Date.now());
  return async function claimAndExtract(userId: string, noteId: string, today: string): Promise<ExtractOutcome> {
    if (deps.tooLong && (await deps.tooLong(userId, noteId))) {
      await deps.setAside?.(userId, noteId);
      return { status: 'too_long' };
    }
    const claimed = await deps.claim(userId, noteId, now());
    if (!claimed) return { status: 'claimed_elsewhere' }; // another worker has it — do nothing
    return deps.extract(userId, noteId, today);
  };
}
