/**
 * The one consistent locked state (P5-1/P5-2). Shown on every premium surface
 * when the trial has lapsed — a calm sentence + a Subscribe action, never a raw
 * error or a broken screen. Capture, Settings, Billing, export and delete stay
 * open elsewhere; this only replaces the gated features.
 */
export function Locked({ onSubscribe }: { onSubscribe: () => void }): JSX.Element {
  return (
    <section
      aria-label="Trial ended"
      role="status"
      style={{ border: '1px solid var(--hairline)', borderRadius: 'var(--radius-card)', background: 'var(--surface-raised)', padding: '1.5rem', textAlign: 'center' }}
    >
      <p style={{ margin: '0 0 1rem', color: 'var(--text-secondary)' }}>Your trial has ended. Subscribe to reopen your book.</p>
      <button className="tov-primary" onClick={onSubscribe}>Subscribe</button>
    </section>
  );
}
