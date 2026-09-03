import { useState } from 'react';

export interface TimezoneApi {
  updateTimezone(timezone: string): Promise<string>;
}

/** A small, curated set covering the launch ICP plus the expansion markets; the rep's own
 *  device zone is always offered too, so a traveller or an unlisted zone is one tap away. */
const COMMON_ZONES = [
  'Asia/Dubai', 'Asia/Riyadh', 'Asia/Qatar', 'Asia/Kuwait', 'Asia/Karachi',
  'Europe/London', 'Europe/Paris', 'America/New_York', 'America/Los_Angeles',
];

function deviceZone(): string | null {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch { return null; }
}

/**
 * [NUDGE-TZ] Edit the rep's timezone. "2 hours before" is meaningless without it, so this is
 * a real setting, not decoration. The server validates the value; the UI just offers sensible
 * choices. Brand: measured, no exclamation, no emoji.
 */
export function TimezoneSetting({ current, api }: { current: string; api: TimezoneApi }): JSX.Element {
  const [zone, setZone] = useState(current);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const device = deviceZone();
  const options = Array.from(new Set([current, device, ...COMMON_ZONES].filter((z): z is string => Boolean(z))));

  async function save(next: string): Promise<void> {
    setError(null);
    try {
      const stored = await api.updateTimezone(next);
      setZone(stored);
      setSaved(stored);
    } catch {
      setError('Could not update the timezone.');
    }
  }

  return (
    <section className="tov-setting-line">
      <label htmlFor="tz-select">Timezone</label>{' '}
      <select id="tz-select" value={zone} onChange={(e) => void save(e.target.value)}>
        {options.map((z) => <option key={z} value={z}>{z}</option>)}
      </select>
      {device && device !== zone && (
        <button type="button" className="tov-link" onClick={() => void save(device)}>Use this device ({device})</button>
      )}
      {saved && <span className="tov-mono" role="status"> Saved · {saved}</span>}
      {error && <span style={{ color: 'var(--claret)' }} role="alert"> {error}</span>}
    </section>
  );
}
