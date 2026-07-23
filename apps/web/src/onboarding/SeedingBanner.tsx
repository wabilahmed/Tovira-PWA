import type { SeedingStatus } from './onboardingClient.js';

/**
 * First-session seeding guidance (P5-3). Walks the rep through exporting ONE
 * WhatsApp chat — never paste-based bulk entry — and offers fallbacks so a rep
 * who skips isn't left with an empty app.
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
      <h2 style={{ marginTop: 0 }}>Seed Tovira in three taps</h2>
      <p style={{ marginTop: 0 }}>{status.nextStep}</p>

      <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: '1fr 1fr' }}>
        <Steps title="On Android" steps={status.seeding.steps.android} />
        <Steps title="On iPhone" steps={status.seeding.steps.ios} />
      </div>

      <button onClick={onStartImport} style={{ marginTop: '1rem' }}>Import a chat</button>

      <p style={{ marginTop: '1.5rem', marginBottom: '0.25rem', color: '#666' }}>Not ready? You can also:</p>
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
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  padding: '1rem 1.25rem',
  background: '#f8fafc',
  margin: '1rem 0',
};
