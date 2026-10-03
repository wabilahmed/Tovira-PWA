import { TranscriptionError, type Transcriber, type TranscriptionResult } from '../../ports/transcriber.js';

export interface GroqTranscriberOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs?: number;
}

/**
 * Groq/Whisper adapter. Posts the audio to the transcription endpoint; any
 * transport/parse failure becomes a typed {@link TranscriptionError} so the
 * pipeline can retry without leaking vendor internals.
 */
export class GroqTranscriber implements Transcriber {
  constructor(private readonly opts: GroqTranscriberOptions) {}

  async transcribe(_userId: string, audio: Uint8Array): Promise<TranscriptionResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs ?? 60_000);
    try {
      const form = new FormData();
      form.append('model', this.opts.model);
      form.append('file', new Blob([audio], { type: 'audio/webm' }), 'note.webm');
      // [USAGE-ALLOWANCE] verbose_json returns the exact billed audio `duration` (seconds), so the gate
      // settles the EXACT transcription cost instead of the byte-length estimate.
      form.append('response_format', 'verbose_json');

      const res = await fetch(`${this.opts.baseUrl}/openai/v1/audio/transcriptions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.opts.apiKey}` },
        body: form,
        signal: controller.signal,
      });
      if (!res.ok) throw new TranscriptionError('transcription request failed', { status: res.status });
      const body = (await res.json()) as { text?: string; duration?: number };
      return { text: body.text ?? '', quality: 'ok', ...(typeof body.duration === 'number' ? { durationSeconds: body.duration } : {}) };
    } catch (err) {
      if (err instanceof TranscriptionError) throw err;
      throw new TranscriptionError('transcription request failed', err);
    } finally {
      clearTimeout(timer);
    }
  }
}
