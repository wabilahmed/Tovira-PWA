import { useCallback, useEffect, useRef, useState } from 'react';
import { EMPTY_STATUS, type ProcessingApi, type ProcessingItem, type ProcessingStatus } from './processingClient.js';

/**
 * [P65 · owner] The rep's processing status, from the server. It polls every few seconds while something is working
 * (or just after the rep sent something, until the server has it), only while the app is visible, and stops when nothing
 * is working. No new infrastructure: a poll of GET /processing. `onSettled` fires once for each item that finishes
 * while the app is open (working → done / failed / held).
 */
export const POLL_MS = 4000;
/** After a send, keep asking this long even if the server has nothing yet (a voice note is still uploading). */
export const KICK_GRACE_MS = 30_000;

export function useProcessing(api: ProcessingApi, opts: { onSettled?: (item: ProcessingItem) => void; pollMs?: number; now?: () => number } = {}): {
  status: ProcessingStatus;
  kick: () => void;
  refresh: () => Promise<void>;
} {
  const pollMs = opts.pollMs ?? POLL_MS;
  const now = opts.now ?? Date.now;
  const [status, setStatus] = useState<ProcessingStatus>(EMPTY_STATUS);
  const [kickedAt, setKickedAt] = useState(0);
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || document.visibilityState !== 'hidden');
  const working = useRef<Set<string>>(new Set());
  const onSettled = useRef(opts.onSettled);
  onSettled.current = opts.onSettled;

  const refresh = useCallback(async () => {
    const s = await api.status();
    if (!s) return;
    const nowWorking = new Set(s.items.filter((i) => i.state === 'working').map((i) => i.noteId));
    for (const i of s.items) if (working.current.has(i.noteId) && !nowWorking.has(i.noteId)) onSettled.current?.(i);
    working.current = nowWorking;
    setStatus(s);
  }, [api]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const onVis = (): void => {
      const v = document.visibilityState !== 'hidden';
      setVisible(v);
      if (v) void refresh(); // back in the app: the status is read fresh from the server
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [refresh]);

  const kick = useCallback(() => { setKickedAt(now()); void refresh(); }, [refresh, now]);
  const active = status.working > 0 || now() - kickedAt < KICK_GRACE_MS;
  useEffect(() => {
    if (!visible || !active) return;
    const t = setInterval(() => { void refresh(); }, pollMs);
    return () => clearInterval(t);
  }, [visible, active, pollMs, refresh]);

  return { status, kick, refresh };
}
