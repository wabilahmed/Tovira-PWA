import { useEffect, useState } from 'react';
import type { Meeting, ParsedMeeting } from './meetingsClient.js';

export interface MeetingsApi {
  list(): Promise<Meeting[]>;
  parse(text: string): Promise<ParsedMeeting | null>;
  createForClient(clientId: string, meeting: { datetime: string | null; datetimeRaw: string; title: string | null }): Promise<Meeting | null>;
  remove(id: string): Promise<boolean>;
}

export interface ClientOption {
  id: string;
  name: string;
}

/** Meetings (P3-1): add via natural language, CONFIRMED before saving, plus list. */
export function Meetings({ api, clients }: { api: MeetingsApi; clients: ClientOption[] }): JSX.Element {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<ParsedMeeting | null>(null);
  const [clientId, setClientId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const nameOf = (id: string): string => clients.find((c) => c.id === id)?.name ?? 'a client';

  const load = (): Promise<void> => api.list().then((m) => { setMeetings(m); setLoading(false); });
  useEffect(() => {
    void load();
  }, [api]);

  async function doParse(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    const parsed = await api.parse(text);
    if (!parsed) {
      setError("Couldn't read a meeting from that — try 'meeting with Acme Tuesday 3pm'.");
      return;
    }
    setPreview(parsed);
    setClientId(parsed.clientId ?? clients[0]?.id ?? '');
  }

  async function confirm(): Promise<void> {
    if (!preview || !clientId) return;
    const created = await api.createForClient(clientId, {
      datetime: preview.datetime,
      datetimeRaw: preview.datetimeRaw,
      title: preview.title,
    });
    if (!created) {
      setError('Could not save the meeting.');
      return;
    }
    setPreview(null);
    setText('');
    void load();
  }

  async function remove(id: string): Promise<void> {
    if (await api.remove(id)) setMeetings((prev) => prev.filter((m) => m.id !== id));
  }

  return (
    <section aria-label="Meetings">
      <h2 style={{ marginTop: 0 }}>Meetings</h2>

      <form onSubmit={doParse} style={{ display: 'flex', gap: '0.5rem' }}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. meeting with Acme next Tuesday 3pm"
          aria-label="Describe the meeting"
          style={{ flex: 1 }}
        />
        <button type="submit" disabled={!text.trim()}>Parse</button>
      </form>
      {error && <p role="alert" style={{ color: 'crimson' }}>{error}</p>}

      {preview && (
        <div data-testid="meeting-preview" style={box}>
          <p style={{ margin: 0 }}>
            <strong>{preview.title ?? 'Meeting'}</strong> — {preview.datetimeRaw}
            {preview.datetime ? ` (${preview.datetime})` : ' (time unconfirmed)'}
          </p>
          <label>
            With{' '}
            <select value={clientId} onChange={(e) => setClientId(e.target.value)} aria-label="Meeting client">
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
          <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem' }}>
            <button onClick={() => void confirm()} disabled={!clientId}>Save meeting</button>
            <button onClick={() => setPreview(null)}>Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        <p>Loading meetings…</p>
      ) : meetings.length === 0 ? (
        <p style={{ color: '#666' }}>No meetings scheduled.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {meetings.map((m) => (
            <li key={m.id} data-testid="meeting" style={{ ...box, display: 'flex', justifyContent: 'space-between' }}>
              <span>
                {m.title ?? 'Meeting'} with {nameOf(m.clientId)} — <small style={{ color: '#888' }}>{m.datetime ?? m.datetimeRaw}</small>
              </span>
              <button onClick={() => void remove(m.id)}>Remove</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const box: React.CSSProperties = { border: '1px solid #e5e7eb', borderRadius: 8, padding: '0.75rem 1rem', margin: '0.75rem 0' };
