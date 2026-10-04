import type { SeedingStatus } from './onboardingClient.js';

/**
 * First-session seeding guidance (P5-3 / BULK-IMPORT). Leads with the bulk ask — export your ten most
 * active chats and select up to 20 at once ("Import chats" opens the multi-select) — never paste-based
 * bulk entry, and offers fallbacks so a rep who skips isn't left with an empty app. The next-step line
 * is a fixed bulk instruction (RULING 2 item 3); the per-platform export steps stay. `status.nextStep`
 * is no longer rendered (the fixed copy replaced it); `status` still drives the steps + fallbacks.
 */
export function SeedingBanner({
  status,
  onStartImport,
  onFallback,
}: {
  status: SeedingStatus;
  onStartImport: () => void;
  onFallback: (kind: string) => void;
}): JSX.Element {
  return (
    <section aria-label="Get started" style={box}>
      <h2 style={{ marginTop: 0 }}>Start with your ten most active clients.</h2>
      <p style={{ marginTop: 0 }}>Export a chat from WhatsApp, then come back here. You can select up to 20 at once.</p>

      <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: '1fr 1fr' }}>
        <Steps title="On Android" steps={status.seeding.steps.android} />
        <Steps title="On iPhone" steps={status.seeding.steps.ios} />
      </div>

      <button className="tov-primary" onClick={onStartImport} style={{ marginTop: '1rem' }}>Import chats</button>

      <p style={{ marginTop: '1.5rem', marginBottom: '0.25rem', color: 'var(--text-secondary)' }}>Not ready? You can also:</p>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        {status.fallbacks.map((f) => (
          <button key={f.kind} onClick={() => onFallback(f.kind)}>{f.label}</button>
        ))}
      </div>
    </section>
  );
}

function Steps({ title, steps }: { title: string; steps: string[] }): JSX.Element {
  return (
    <div>
      <strong>{title}</strong>
      <ol style={{ margin: '0.25rem 0 0', paddingLeft: '1.2rem' }}>
        {steps.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ol>
    </div>
  );
}

const box: React.CSSProperties = {
  border: '1px solid var(--hairline)',
  borderRadius: 8,
  padding: '1rem 1.25rem',
  background: 'var(--surface-raised)',
  margin: '1rem 0',
};
