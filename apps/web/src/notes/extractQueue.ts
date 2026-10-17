/**
 * [P16-3c] Which pending notes the client should actually ask the server to extract. A note is skipped
 * when it is already blocked by the trial/paid ceiling (asking just hits it again) OR carries a
 * blockedReason (lapsed trial / failed payment / spent allowance) — the server would only 402 it and the
 * sweep skips it anyway, so re-asking on every refresh is pointless noise. It resumes on its own once the
 * block clears (the next list carries no blockedReason). Pure, so it is unit-tested directly.
 */
export interface ReExtractNote {
  id: string;
  status: string;
  blockedReason?: 'subscribe' | 'payment' | 'allowance' | null;
}

export function notesToExtract<T extends ReExtractNote>(notes: T[], ceilingNoteIds: Set<string>): T[] {
  return notes.filter((n) => n.status === 'pending_extraction' && !ceilingNoteIds.has(n.id) && !n.blockedReason);
}
