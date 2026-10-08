/**
 * [AUDIT item 4] When ops flips the AI_PAUSED kill switch, notes just sat as "pending" with no
 * explanation — reps thought the app was broken. This slim, reassuring banner says the work is only
 * delayed. Reads the flag the server already exposes on /allowance/status (30s-cached); shows nothing
 * when AI is running.
 */
export function AiPausedBanner({ paused }: { paused: boolean }): JSX.Element | null {
  if (!paused) return null;
  return (
    <div
      role="status"
      data-testid="ai-paused-banner"
      style={{ background: 'var(--surface-elevated)', color: 'var(--text-primary)', borderBottom: '1px solid var(--hairline)', padding: '0.5rem 1rem', fontSize: '0.85rem', lineHeight: 1.4 }}
    >
      AI processing is delayed. Your notes are saved and will process shortly.
    </div>
  );
}
