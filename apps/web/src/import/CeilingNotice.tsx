/**
 * The trial seeding-ceiling message (P5-1-CEILING-UI). Shown when the free-trial
 * extraction ceiling stopped the Book Scan. It is deliberately reassuring — the
 * rep's chats are saved, nothing is lost, and upgrading lifts the limit — never
 * a scary "import failed". The ceiling is enforced and counted server-side; this
 * only renders the state the server reported (no client-side ceiling math).
 */
export function CeilingNotice({ imported }: { imported?: number }): JSX.Element {
  return (
    <div data-testid="ceiling-notice" role="status" style={box}>
      <strong>Your chats are saved.</strong>
      <p style={{ margin: '0.25rem 0 0' }}>
        {typeof imported === 'number' && imported > 0
          ? `We scanned ${imported} message${imported === 1 ? '' : 's'} and reached your free-trial scanning limit. `
          : 'You’ve reached your free-trial scanning limit. '}
        Nothing is lost — upgrade any time to scan the rest.
      </p>
    </div>
  );
}

const box: React.CSSProperties = {
  border: '1px solid var(--amber-line)',
  background: 'var(--amber-surface)',
  color: 'var(--amber)',
  borderRadius: 8,
  padding: '0.75rem 1rem',
  margin: '0.5rem 0',
};
