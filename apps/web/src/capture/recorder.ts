/** Thin MediaRecorder wrapper: start recording, stop → the recorded audio Blob. */
export interface ActiveRecording {
  stop(): Promise<Blob>;
}

export function startRecording(stream: MediaStream): ActiveRecording {
  const chunks: BlobPart[] = [];
  const recorder = new MediaRecorder(stream);
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };
  recorder.start();

  return {
    stop: () =>
      new Promise<Blob>((resolve) => {
        recorder.onstop = () => {
          stream.getTracks().forEach((track) => track.stop());
          resolve(new Blob(chunks, { type: 'audio/webm' }));
        };
        recorder.stop();
      }),
  };
}
