import { redactSensitive } from '../redaction/redact.js';
import type { Transcriber } from '../../ports/transcriber.js';
import type { NoteRepository } from '../../ports/note-repository.js';
import type { Storage } from '../../ports/storage.js';

export interface TranscribeOutcome {
  status: string;
  retry?: boolean;
}

/** Terminal status when a voice note's recording is confirmed gone — distinct from the generic
 *  needs_review so the rep sees WHY (the UI renders a human reason for it). */
export const TRANSCRIPTION_FAILED_STATUS = 'transcription_failed';

/** Confirmed-missing-audio attempts before a voice note fails terminally. Derivation: the notes-sweep
 *  runs every ~15s; requiring the recording to be CONFIRMED ABSENT (storage.exists() === false — not a
 *  transient fetch error) on 3 passes (~45s) rules out a brief post-upload read-after-write window while
 *  failing fast — well before the sweep's generic 5-attempt needs_review budget, and without burning
 *  cycles on an object that will never appear. Object stores are read-after-write consistent for new
 *  keys, so a confirmed-absent object is genuinely gone. */
export const TRANSCRIBE_MAX_MISSING_ATTEMPTS = 3;

/**
 * Turn a voice note's audio into a transcript (P1-5). Principle: never lose a
 * note. A transcription API error leaves the note PENDING for retry; empty or
 * low-quality audio still stores whatever we got but FLAGS the note for review —
 * it is never silently dropped.
 */
export class TranscriptionService {
  constructor(
    private readonly transcriber: Transcriber,
    private readonly notes: NoteRepository,
    private readonly storage: Storage,
  ) {}

  async transcribeNote(userId: string, noteId: string): Promise<TranscribeOutcome> {
    const note = await this.notes.findByIdForUser(userId, noteId);
    if (!note) return { status: 'not_found' };
    if (note.source !== 'voice' || !note.audioKey) return { status: note.status };

    let audio: Uint8Array;
    try {
      audio = await this.storage.get(note.audioKey);
    } catch {
      // The fetch failed. Distinguish a GENUINELY ABSENT recording (terminal — it will never appear,
      // e.g. the object was never durably stored) from a transient fetch error (retry). Only
      // exists() === false is a confident absence; if exists() itself errors or reports present, treat
      // it as transient and keep retrying. After TRANSCRIBE_MAX_MISSING_ATTEMPTS confirmed absences the
      // note fails terminally with a distinct status the UI explains — instead of looking "transcribing"
      // until the sweep's generic 5-attempt needs_review, burning cycles on work that can never succeed.
      let present = true;
      try {
        present = await this.storage.exists(note.audioKey);
      } catch {
        present = true; // can't confirm absence → treat as transient
      }
      if (!present && note.sweepAttempts >= TRANSCRIBE_MAX_MISSING_ATTEMPTS) {
        await this.notes.update(userId, noteId, { status: TRANSCRIPTION_FAILED_STATUS });
        return { status: TRANSCRIPTION_FAILED_STATUS };
      }
      return { status: 'pending_transcription', retry: true };
    }

    let text: string;
    let quality: 'ok' | 'low' | undefined;
    try {
      const result = await this.transcriber.transcribe(audio);
      text = result.text ?? '';
      quality = result.quality;
    } catch {
      // API error/timeout → keep the note pending; a later run retries it.
      return { status: 'pending_transcription', retry: true };
    }

    const flagged = text.trim() === '' || quality === 'low';
    const status = flagged ? 'needs_review' : 'pending_extraction';
    // REDACT-2: strip Tier-1 sensitive values from the transcript BEFORE storage —
    // a client reading out a card number or OTP must never land in the raw store.
    const r = redactSensitive(text);
    if (r.total > 0) {
      console.info(`[redact] voice note ${noteId}: ${r.total} Tier-1 value(s) redacted`);
    }
    await this.notes.update(userId, noteId, { rawText: r.redacted, status });
    return { status };
  }
}
