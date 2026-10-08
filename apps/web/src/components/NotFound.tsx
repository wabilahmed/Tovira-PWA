/**
 * [AUDIT item 2] An unknown SPA path used to silently fall back to the app shell. Show an honest
 * "Page not found" with a way back, in the existing card/button styles.
 */
export function NotFound(): JSX.Element {
  return (
    <section className="tov-card" role="alert" aria-label="Page not found" style={{ margin: '2rem auto', maxWidth: 440, textAlign: 'center', display: 'grid', gap: '0.75rem' }}>
      <h1 style={{ margin: 0 }}>Page not found</h1>
      <p style={{ margin: 0, color: 'var(--text-secondary)' }}>That page doesn’t exist.</p>
      <div>
        <button className="tov-primary" type="button" onClick={() => { if (typeof window !== 'undefined') window.location.assign('/app?view=today'); }}>
          Back to Today
        </button>
      </div>
    </section>
  );
}
