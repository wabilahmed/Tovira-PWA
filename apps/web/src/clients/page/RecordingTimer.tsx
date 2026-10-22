import { useEffect, useState } from 'react';

/** "01:05" — minutes and seconds, zero-padded. */
export function mmss(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
}

/**
 * [P36-5] The live timer on the client page's voice recorder (restored from the old Capture screen): mm:ss
 * elapsed, and — when the recording has a maximum length — the time left before it stops itself. Mono, and
 * claret while recording (the app's one "can't be replayed" action).
 */
export function RecordingTimer({ startedAt, maxMs }: { startedAt: number; maxMs?: number }): JSX.Element {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const elapsed = Math.max(0, now - startedAt);
  return (
    <div className="tov-rectimer" role="timer" aria-label="Recording time">
      <span className="tov-mono" data-testid="rec-elapsed" style={{ fontSize: 'var(--text-section-size)', color: 'var(--claret)' }}>{mmss(elapsed)}</span>
      {maxMs !== undefined && <span className="tov-muted" data-testid="rec-remaining"> · {mmss(maxMs - elapsed)} left</span>}
    </div>
  );
}
