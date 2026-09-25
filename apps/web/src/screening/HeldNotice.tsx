/**
 * [SCREEN-REVIEW] Honest coverage + the persistent held indicator. Placement (owner ruling):
 *  - 'full'  — BOTH sentences. Shown at import completion and BESIDE the streaming scan, because the
 *              moment a rep needs to know the screen is not exhaustive is when they think they're done.
 *  - 'short' — first sentence only. Inside the review list, "read the conversation, not just the flags"
 *              is odd (that IS what they're doing), so the list keeps only the first sentence.
 *  - 'indicator' — the persistent held count, shown wherever the note or client appears.
 */
const FIRST = "We hold messages that mention sensitive topics so you can decide before they're analysed.";
const SECOND = 'We catch direct mentions well and indirect phrasing poorly — so read the conversation, not just the flags.';

export function HeldNotice({ variant, held = 0 }: { variant: 'full' | 'short' | 'indicator'; held?: number }): JSX.Element {
  if (variant === 'indicator') {
    return (
      <p data-testid="held-notice" className="tov-held-indicator" style={{ color: 'var(--amber)', margin: '0.5rem 0' }}>
        {held} message{held === 1 ? '' : 's'} held pending your review — not yet analysed.
      </p>
    );
  }
  return (
    <p data-testid="held-notice" style={{ color: 'var(--text-secondary)', margin: '0.5rem 0' }}>
      {FIRST}
      {variant === 'full' && <> {SECOND}</>}
    </p>
  );
}
