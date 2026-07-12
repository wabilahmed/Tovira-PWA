/**
 * Request microphone access with a clear, non-crashing result. If it's
 * unsupported or the rep denies permission, we return guidance instead of
 * throwing — the app must never appear to be silently recording (P1-3).
 */
export interface MicResult {
  granted: boolean;
  stream?: MediaStream;
  guidance?: string;
}

export async function requestMicrophone(mediaDevices?: MediaDevices): Promise<MicResult> {
  const devices =
    mediaDevices ??
    (typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined);

  if (!devices || typeof devices.getUserMedia !== 'function') {
    return { granted: false, guidance: 'Recording isn’t supported in this browser.' };
  }

  try {
    const stream = await devices.getUserMedia({ audio: true });
    return { granted: true, stream };
  } catch {
    return {
      granted: false,
      guidance: 'Microphone access was denied. Enable it in your browser settings to record a voice note.',
    };
  }
}
