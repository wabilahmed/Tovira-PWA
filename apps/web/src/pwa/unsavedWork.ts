/**
 * [P14-4b] A tiny registry of "would a reload lose something?" sources, so the service-worker update flow
 * can decide between a SILENT update (nothing to lose) and a prompt (leave it to the rep). Sources:
 *   - the capture outbox (a recording pending upload lives in IndexedDB — see App.tsx), and
 *   - an in-progress recording (a MediaRecorder running right now — see Capture.tsx).
 *
 * Fail SAFE: if any source throws, we treat it as unsaved (prompt rather than risk a silent reload).
 */
type UnsavedSource = () => boolean | Promise<boolean>;

const sources = new Set<UnsavedSource>();

/** Register a source; returns an unsubscribe to call on unmount. */
export function registerUnsavedSource(fn: UnsavedSource): () => void {
  sources.add(fn);
  return () => { sources.delete(fn); };
}

/** True if ANY registered source reports unsaved work (or throws — we never risk a silent reload then). */
export async function hasUnsavedWork(): Promise<boolean> {
  for (const fn of sources) {
    try {
      if (await fn()) return true;
    } catch {
      return true;
    }
  }
  return false;
}
