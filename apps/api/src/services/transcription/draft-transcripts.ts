import { createHash } from 'node:crypto';

/**
 * [P67-2 · owner] New client by voice: the recording is transcribed once, for the confirm step, and the SAME
 * recording is then uploaded as the client's first voice note. This keeps that transcript briefly in memory, keyed by
 * the rep and a hash of the exact audio bytes, so the voice note uses it instead of transcribing again.
 *
 * Nothing is stored durably (the P57 rule: the draft stores nothing): it lives in this process only, Tier-1 blanked,
 * for 30 minutes, and is taken once. A miss (another server, a restart, a different recording) just transcribes as
 * before, so it can only save a call, never lose or change a note.
 */
export const DRAFT_TRANSCRIPT_TTL_MS = 30 * 60_000;
const MAX_ENTRIES = 1_000;

export interface DraftTranscript { text: string; quality?: 'ok' | 'low' }

export class DraftTranscriptCache {
  private readonly entries = new Map<string, DraftTranscript & { at: number }>();
  constructor(private readonly now: () => number = () => Date.now()) {}

  private key(userId: string, audio: Uint8Array): string {
    return createHash('sha256').update(userId).update('\0').update(audio).digest('hex');
  }

  put(userId: string, audio: Uint8Array, t: DraftTranscript): void {
    this.sweep();
    if (this.entries.size >= MAX_ENTRIES) this.entries.delete(this.entries.keys().next().value!);
    this.entries.set(this.key(userId, audio), { ...t, at: this.now() });
  }

  /** The transcript for exactly this rep and these bytes, once; null when absent or expired. */
  take(userId: string, audio: Uint8Array): DraftTranscript | null {
    const k = this.key(userId, audio);
    const e = this.entries.get(k);
    if (!e) return null;
    this.entries.delete(k);
    if (e.at <= this.now() - DRAFT_TRANSCRIPT_TTL_MS) return null;
    return { text: e.text, ...(e.quality ? { quality: e.quality } : {}) };
  }

  private sweep(): void {
    const cutoff = this.now() - DRAFT_TRANSCRIPT_TTL_MS;
    for (const [k, e] of this.entries) if (e.at <= cutoff) this.entries.delete(k);
  }
}
