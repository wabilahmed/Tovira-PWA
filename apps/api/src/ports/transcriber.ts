/**
 * Port: speech-to-text. Local dev uses a stub; prod calls Groq/Whisper — a
 * config swap, not a rewrite.
 */

export interface TranscriptionResult {
  text: string;
  /** Optional quality hint; 'low' flags a note for review without discarding it. */
  quality?: 'ok' | 'low';
  /** [USAGE-ALLOWANCE] Exact billed audio duration (seconds) the provider reports (Groq verbose_json).
   *  Used to settle the EXACT transcription cost; absent → the gate falls back to the byte-length estimate. */
  durationSeconds?: number;
}

export interface Transcriber {
  /** [USAGE-ALLOWANCE] `userId` attributes the (duration-priced) cost to the rep's allowance via the gate. */
  transcribe(userId: string, audio: Uint8Array): Promise<TranscriptionResult>;
}

/** Typed failure so the caller can retry without leaking vendor internals. */
export class TranscriptionError extends Error {
  override name = 'TranscriptionError';
  constructor(message: string, cause?: unknown) {
    super(message);
    if (cause !== undefined) this.cause = cause;
  }
}
