import { hapticTick } from '../haptics.js';
import { useEffect, useState } from 'react';
import { Button, TextInput, Toast } from '../ui/index.js';
import { displayPhone, needsCountryCode, NEEDS_COUNTRY_CODE } from '../format/phone.js';

/**
 * A client's contact phone (P4-7 → P46-4). The label sits above a full-width field and Save has its own row, so nothing
 * wraps letter by letter at 390px. The server validates the number and stores it in international form; the field shows
 * it formatted ("+971 50 386 3103"). A refused number shows the server's fix; "Saved" is a Toast. Tovira never guesses a
 * country code.
 */
export function ClientPhoneField({
  phone,
  onSave,
}: {
  phone: string | null;
  /** Throws with the server's message when the number is refused. */
  onSave: (phone: string | null) => Promise<void>;
}): JSX.Element {
  const [value, setValue] = useState(displayPhone(phone));
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setValue(displayPhone(phone)); }, [phone]);
  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(false), 2500);
    return () => clearTimeout(t);
  }, [saved]);

  async function save(): Promise<void> {
    setBusy(true);
    setSaved(false);
    setError(null);
    try {
      await onSave(value.trim() || null);
      setSaved(true);
      hapticTick(); // saved — a commit
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the phone.');
    } finally {
      setBusy(false);
    }
  }

  const hint = !error && needsCountryCode(phone) && value === phone ? NEEDS_COUNTRY_CODE : null;
  return (
    <div className="ui-stack ui-gap-2" data-testid="client-phone">
      <TextInput
        label="Phone"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        value={value}
        onChange={(e) => { setValue(e.target.value); setSaved(false); setError(null); }}
        placeholder="+971 50 123 4567"
      />
      {error && <p role="alert" className="ui-danger">{error}</p>}
      {hint && <p className="ui-secondary">{hint}</p>}
      <div><Button size="sm" onClick={() => void save()} loading={busy}>Save</Button></div>
      {saved && <Toast>Saved</Toast>}
    </div>
  );
}
