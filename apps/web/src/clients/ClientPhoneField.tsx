import { hapticTick } from '../haptics.js';
import { useState } from 'react';

/**
 * Manual entry of a client's contact phone (P4-7). Stored as the rep types it —
 * we never rewrite it or guess a country code (the WhatsApp link falls back to
 * the picker when a country code is missing). Saving is explicit.
 */
export function ClientPhoneField({
  phone,
  onSave,
}: {
  phone: string | null;
  onSave: (phone: string | null) => Promise<void>;
}): JSX.Element {
  const [value, setValue] = useState(phone ?? '');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save(): Promise<void> {
    setBusy(true);
    setSaved(false);
    await onSave(value.trim() || null);
    setBusy(false);
    setSaved(true);
    hapticTick(); // saved — a commit
  }

  return (
    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', margin: '0.5rem 0' }}>
      <label style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
        Phone
        <input
          type="tel"
          value={value}
          onChange={(e) => { setValue(e.target.value); setSaved(false); }}
          placeholder="+971 50 123 4567"
          aria-label="Client phone"
          style={{ minWidth: 180 }}
        />
      </label>
      <button onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      {saved && <small style={{ color: 'var(--green)' }}>Saved</small>}
    </div>
  );
}
