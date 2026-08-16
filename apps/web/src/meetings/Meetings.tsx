import { useEffect, useState } from 'react';
import type { Meeting, ParseResult } from './meetingsClient.js';

export interface MeetingsApi {
  list(): Promise<Meeting[]>;
  parse(text: string): Promise<ParseResult | null>;
  createForClient(clientId: string, meeting: { datetime: string | null; datetimeRaw: string; title: string | null }): Promise<Meeting | null>;
  remove(id: string): Promise<boolean>;
}

/** A proposal ready to save — either the parser's own proposal, or one the rep
 *  built by choosing among ambiguous candidates. */
interface Proposal { clientId: string; datetime: string | null; datetimeRaw: string; }

export interface ClientOption {
  id: string;
  name: string;
}

/** Meetings (P3-1): add via natural language, CONFIRMED before saving, plus list. */
export function Meetings({ api, clients }: { api: MeetingsApi; clients: ClientOption[] }): JSX.Element {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [text, setText] = useState('');
  const [result, setResult] = useState<ParseResult | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
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
    setProposal(null);
    const parsed = await api.parse(text);
    if (!parsed) {
      setError("Couldn't read a meeting from that — try 'meeting with Acme Tuesday 3pm'.");
      setResult(null);
      return;
    }
    setResult(parsed);
    // A clear proposal goes straight to the confirm preview; an ambiguous name
    // or time falls through to its own prompt (see the render) — never a silent pick.
    if (parsed.kind === 'proposal') {
      setProposal({ clientId: parsed.clientId, datetime: parsed.datetime, datetimeRaw: parsed.datetimeRaw });
      setClientId(parsed.clientId);
    }
  }

  /** The rep picked one of the ambiguous candidates → build a saveable proposal. */
  function chooseCandidate(id: string): void {
    if (result?.kind !== 'ambiguous_client') return;
    setProposal({ clientId: id, datetime: result.datetime, datetimeRaw: result.datetimeRaw });
    setClientId(id);
  }

  function reset(): void {
    setResult(null);
    setProposal(null);
  }

  async function confirm(): Promise<void> {
    if (!proposal || !clientId) return;
    const created = await api.createForClient(clientId, {
      datetime: proposal.datetime,
      datetimeRaw: proposal.datetimeRaw,
      title: null,
    });
    if (!created) {
      setError('Could not save the meeting.');
      return;
    }
    reset();
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
      {error && <p role="alert" style={{ color: 'var(--claret)' }}>{error}</p>}

      {/* A clear proposal (parser's, or one built from a chosen candidate) → confirm. */}
      {proposal && (
        <div data-testid="meeting-preview" style={box}>
          <p style={{ margin: 0 }}>
            <strong>Meeting</strong> — {proposal.datetimeRaw}
            {proposal.datetime ? ` (${proposal.datetime})` : ' (time unconfirmed)'}
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
            <button onClick={reset}>Cancel</button>
          </div>
        </div>
      )}

      {/* Ambiguous name → ASK which client (never silently pick one). */}
      {result?.kind === 'ambiguous_client' && !proposal && (
        <div style={box}>
          <p style={{ margin: '0 0 0.5rem' }}>Which client did you mean for <strong>{result.datetimeRaw}</strong>?</p>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {result.candidates.map((c) => (
              <button key={c.id} onClick={() => chooseCandidate(c.id)}>{c.name}</button>
            ))}
            <button onClick={reset}>Cancel</button>
          </div>
        </div>
      )}

      {/* No match → say so; don't invent a client. */}
      {result?.kind === 'no_client' && (
        <div style={box}>
          <p style={{ margin: 0 }}>No client matches “{result.name}”. Add them first, then schedule the meeting.</p>
        </div>
      )}

      {/* Vague time → ask for a specific one; never invent a datetime. */}
      {result?.kind === 'ambiguous_time' && (
        <div style={box}>
          <p style={{ margin: 0 }}>I couldn't pin a specific time from “{result.datetimeRaw}”. Try a specific time, e.g. “Tuesday 3pm”.</p>
        </div>
      )}

      {loading ? (
        <p>Loading meetings…</p>
      ) : meetings.length === 0 ? (
        <p style={{ color: 'var(--text-secondary)' }}>No meetings scheduled.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {meetings.map((m) => (
            <li key={m.id} data-testid="meeting" style={{ ...box, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.75rem' }}>
              <span>
                {m.title ?? 'Meeting'} with {nameOf(m.clientId)} — <small className="tov-stamp">{m.datetime ?? m.datetimeRaw}</small>
              </span>
              <button onClick={() => void remove(m.id)}>Remove</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const box: React.CSSProperties = { border: '1px solid var(--hairline)', borderRadius: 8, padding: '0.75rem 1rem', margin: '0.75rem 0' };
