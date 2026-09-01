import { redactSensitive } from '../redaction/redact.js';
import type { Transcriber } from '../../ports/transcriber.js';
import type { NoteRepository } from '../../ports/note-repository.js';
import type { Storage } from '../../ports/storage.js';

export interface TranscribeOutcome {
  status: string;
  retry?: boolean;
}

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
