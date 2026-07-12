/**
 * Port: speech-to-text. Local dev uses a stub; prod calls Groq/Whisper — a
 * config swap, not a rewrite.
 */

export interface TranscriptionResult {
  text: string;
  /** Optional quality hint; 'low' flags a note for review without discarding it. */
  quality?: 'ok' | 'low';
}

export interface Transcriber {
  transcribe(audio: Uint8Array): Promise<TranscriptionResult>;
}

/** Typed failure so the caller can retry without leaking vendor internals. */
export class TranscriptionError extends Error {
  override name = 'TranscriptionError';
  constructor(message: string, cause?: unknown) {
    super(message);
    if (cause !== undefined) this.cause = cause;
  }
}
