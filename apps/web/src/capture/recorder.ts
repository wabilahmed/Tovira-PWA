/** Thin MediaRecorder wrapper: start recording, stop → the recorded audio Blob. */
export interface ActiveRecording {
  stop(): Promise<Blob>;
}

/** [VOICE-GATE] Pin the encoding bitrate so the server's byte cap maps to a known duration (≈10 min).
 *  96 kbps is generous for voice (WhatsApp voice notes are ~16–24 kbps) and keeps the file small. We do
 *  NOT pin a mimeType: Safari/iOS can't encode WebM and would throw — it produces MP4, which the server
 *  accepts by sniffing the bytes. */
const AUDIO_BITS_PER_SECOND = 96_000;
/** Auto-stop a recording at the length cap so a rep never hits the server's 413. Matches the server
 *  VOICE_MAX_BYTES derivation (10 minutes). Client-side convenience; the server is the real enforcement. */
export const MAX_RECORDING_MS = 10 * 60 * 1000;

export function startRecording(stream: MediaStream): ActiveRecording {
  const chunks: BlobPart[] = [];
  const recorder = new MediaRecorder(stream, { audioBitsPerSecond: AUDIO_BITS_PER_SECOND });
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };
  recorder.start();
  const stopSafely = (): void => {
    if (recorder.state !== 'inactive') recorder.stop();
  };
  const cap = setTimeout(stopSafely, MAX_RECORDING_MS);

  return {
    stop: () =>
      new Promise<Blob>((resolve) => {
        recorder.onstop = () => {
          clearTimeout(cap);
          stream.getTracks().forEach((track) => track.stop());
          resolve(new Blob(chunks, { type: 'audio/webm' }));
        };
        stopSafely();
      }),
  };
}
