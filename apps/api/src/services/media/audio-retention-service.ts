import type { NoteRepository } from '../../ports/note-repository.js';
import type { Storage } from '../../ports/storage.js';

/**
 * How long a voice recording is kept after its transcription SUCCEEDS, before the audio object is
 * deleted. DERIVATION: playback and re-transcription are useful in the DAYS after a recording, not the
 * months; erasure requests arrive weeks to months later, so a 30-day window means they almost never
 * encounter audio at all. The clock starts on SUCCESSFUL transcription (notes.transcribed_at), never on
 * upload — a note still in transcription_failed keeps its audio indefinitely (that recording is the only
 * copy of the capture, and deleting it would destroy the thing the rep recorded). NOT user-configurable:
 * one value, applied to everyone.
 */
export const AUDIO_RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface AudioRetentionDeps {
  allUserIds: () => Promise<string[]>;
  notes: Pick<NoteRepository, 'listExpirableAudio' | 'update'>;
  storage: Pick<Storage, 'delete'>;
}

/**
 * [AUDIO-RETENTION] Deletes voice recordings AUDIO_RETENTION_DAYS after transcription succeeded. Runs on
 * the existing ScheduledBrain (advisory-lock + timer) with its own lockKey — NOT a second scheduler (see
 * the job registration in index.ts). Idempotent: a swept note has no audio_key, so a re-run finds nothing.
 */
export class AudioRetentionService {
  private readonly now: () => number;
  constructor(
    private readonly deps: AudioRetentionDeps,
    now: () => number = () => Date.now(),
  ) {
    this.now = now;
  }

  /** Delete every expired recording across all reps; mark each note audio-expired. Returns the count.
   *  Order matters: the object is deleted FIRST, then the row is cleared — so a storage failure leaves
   *  the row pointing at the (undeleted) object and the next sweep retries, never orphaning a blob. */
  async sweep(nowMs: number = this.now()): Promise<number> {
    const cutoff = nowMs - AUDIO_RETENTION_DAYS * DAY_MS;
    let deleted = 0;
    for (const userId of await this.deps.allUserIds()) {
      for (const { id, audioKey } of await this.deps.notes.listExpirableAudio(userId, cutoff)) {
        await this.deps.storage.delete(audioKey); // idempotent — a missing object is a no-op
        await this.deps.notes.update(userId, id, { audioKey: null, audioExpiredAt: nowMs });
        deleted += 1;
      }
    }
    return deleted;
  }
}
