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

/**
 * [P46-2] How a zone reads: the city with its GMT offset ("Dubai (GMT+4)"), never "Asia/Dubai". The stored value is
 * unchanged. Falls back to the raw id if the browser cannot name the offset.
 */
export function zoneLabel(tz: string, at: Date = new Date()): string {
  const city = (tz.split('/').pop() ?? tz).replace(/_/g, ' ');
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' }).formatToParts(at).find((p) => p.type === 'timeZoneName');
    // ICU versions differ: some say "GMT+0" for UTC, others "GMT". Read the same everywhere.
    return part ? `${city} (${part.value.replace(/^GMT[+-]0$/, 'GMT')})` : city;
  } catch {
    return city;
  }
}

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
      setError('Could not update the time zone.');
    }
  }

  // [P46-2] The Settings section's "Time zone" is the one visible label; the select carries it for screen readers.
  return (
    <div className="ui-stack ui-gap-2">
      <label htmlFor="tz-select" className="sr-only">Time zone</label>
      <select id="tz-select" className="ui-input ui-native-select" value={zone} onChange={(e) => void save(e.target.value)}>
        {options.map((z) => <option key={z} value={z}>{zoneLabel(z)}</option>)}
      </select>
      {device && device !== zone && (
        <div><button type="button" className="ui-btn ui-btn--text ui-btn--sm" onClick={() => void save(device)}>Use this phone’s time zone ({zoneLabel(device)})</button></div>
      )}
      {saved && <p className="ui-secondary" role="status">Saved: {zoneLabel(saved)}</p>}
      {error && <p className="ui-danger" role="alert">{error}</p>}
    </div>
  );
}
