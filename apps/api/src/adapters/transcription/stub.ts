import type { Transcriber, TranscriptionResult } from '../../ports/transcriber.js';

/**
 * Local stand-in for Groq/Whisper: returns a canned transcript so the capture →
 * transcribe → extract flow runs offline with no API key or spend.
 */
export class StubTranscriber implements Transcriber {
  constructor(private readonly text = '[stub transcript]') {}
  async transcribe(): Promise<TranscriptionResult> {
    return { text: this.text, quality: 'ok' };
  }
}
