import type { Transcriber, TranscriptionResult } from '../../ports/transcriber.js';
import type { TranscriptionEvent } from '../../ports/cost-report.js';
import { VOICE_BYTES_PER_SECOND } from '../../services/spend/ai-prices.js';

/** [P44-2] Where completed transcriptions are recorded; set once at boot (like the model-call event sink). */
export interface TranscriptionEventSink {
  periodKeyFor(userId: string): Promise<string | null>;
  record(e: TranscriptionEvent): Promise<void>;
}
let sink: TranscriptionEventSink | undefined;
export function setTranscriptionEventSink(s: TranscriptionEventSink | undefined): void {
  sink = s;
}

/**
 * [P44-2] Records each COMPLETED voice-note transcription (user, audio seconds, model, billing period) for the ops
 * cost report. Seconds are the provider's own (Groq verbose_json); without them, the byte-length estimate at the
 * pinned 96 kbps, marked `estimated`. A failed transcription records nothing; a failed record never breaks the
 * transcription (the rep's voice note matters more than the accounting row).
 */
export class RecordingTranscriber implements Transcriber {
  constructor(private readonly inner: Transcriber, private readonly modelId: string, private readonly now: () => number = () => Date.now()) {}

  async transcribe(userId: string, audio: Uint8Array): Promise<TranscriptionResult> {
    const result = await this.inner.transcribe(userId, audio);
    const s = sink;
    if (s) {
      try {
        const provided = typeof result.durationSeconds === 'number' && Number.isFinite(result.durationSeconds);
        await s.record({
          userId,
          periodKey: await s.periodKeyFor(userId),
          model: this.modelId,
          audioSeconds: provided ? Math.max(0, result.durationSeconds!) : audio.length / VOICE_BYTES_PER_SECOND,
          estimated: !provided,
          at: this.now(),
        });
      } catch (err) {
        console.warn(`[cost-report] transcription event not recorded for ${userId} (voice note unaffected): ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return result;
  }
}
