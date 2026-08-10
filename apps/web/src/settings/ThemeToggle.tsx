import { useState } from 'react';
import { getTheme, setTheme, type ThemeChoice } from '../styles/theme.js';

const OPTIONS: Array<{ value: ThemeChoice; label: string }> = [
  { value: 'system', label: 'System' },
  { value: 'vault', label: 'Vault' },
  { value: 'ledger', label: 'Ledger' },
];

/**
 * The two materials, chosen by hand (docs/tovira-brand.md §1). System follows the
 * device; Vault is the dark identity; Ledger is daylight paper.
 */
export function ThemeToggle(): JSX.Element {
  const [choice, setChoice] = useState<ThemeChoice>(() => getTheme());

  function pick(next: ThemeChoice): void {
    setChoice(next);
    setTheme(next);
  }

  return (
    <section aria-label="Appearance" style={{ margin: '1.5rem 0' }}>
      <h2 style={{ fontSize: '1rem', marginTop: 0 }}>Appearance</h2>
      <div role="group" aria-label="Theme" style={{ display: 'inline-flex', border: '1px solid var(--hairline)', borderRadius: 'var(--radius-card)', overflow: 'hidden' }}>
        {OPTIONS.map((o) => {
          const active = choice === o.value;
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={active}
              onClick={() => pick(o.value)}
              style={{
                minHeight: 40,
                border: 'none',
                borderRadius: 0,
                padding: '0 16px',
                background: active ? 'var(--brass)' : 'transparent',
                color: active ? 'var(--brass-ink)' : 'var(--text-secondary)',
                fontWeight: active ? 600 : 400,
              }}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      <p style={{ color: 'var(--text-tertiary)', fontSize: '0.8rem', marginBottom: 0 }}>
        Vault is the default. Ledger suits bright daylight; System follows your device.
      </p>
    </section>
  );
}
