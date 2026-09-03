import { hapticTick } from '../haptics.js';
import { useEffect, useState } from 'react';
import type { Meeting, ParseResult } from './meetingsClient.js';

export interface MeetingsApi {
  list(): Promise<Meeting[]>;
  parse(text: string): Promise<ParseResult | null>;
  createForClient(clientId: string, meeting: { datetime: string | null; datetimeRaw: string; title: string | null }): Promise<Meeting | null>;
  remove(id: string): Promise<boolean>;
  confirm(id: string): Promise<Meeting | null>;
}

/** A proposal ready to save — either the parser's own proposal, or one the rep
 *  built by choosing among ambiguous candidates. */
interface Proposal { clientId: string; datetime: string | null; datetimeRaw: string; }

export interface ClientOption {
  id: string;
  name: string;
}

/** Meetings (P3-1): add via natural language, CONFIRMED before saving, plus list. */
export function Meetings({ api, clients, onCreateClient }: { api: MeetingsApi; clients: ClientOption[]; onCreateClient?: (name: string) => Promise<ClientOption> }): JSX.Element {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [text, setText] = useState('');
  const [result, setResult] = useState<ParseResult | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [clientId, setClientId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Direct form (MEETING-CREATE): client + date + time + optional title, no NL parse.
  const [dClient, setDClient] = useState('');
  const [dDate, setDDate] = useState('');
  const [dTime, setDTime] = useState('');
  const [dTitle, setDTitle] = useState('');
  const [dError, setDError] = useState<string | null>(null);

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
    // A clear proposal → confirm preview. A vague TIME is still saveable — the
    // raw phrase is kept and the time shows "(time unconfirmed)", never invented.
    // An ambiguous NAME asks which client; no match offers to create one.
    if (parsed.kind === 'proposal') {
      setProposal({ clientId: parsed.clientId, datetime: parsed.datetime, datetimeRaw: parsed.datetimeRaw });
      setClientId(parsed.clientId);
    } else if (parsed.kind === 'ambiguous_time') {
      setProposal({ clientId: clients[0]?.id ?? '', datetime: null, datetimeRaw: parsed.datetimeRaw });
      setClientId(clients[0]?.id ?? '');
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

  /** Create the unmatched client, then let the rep re-parse (the text is kept). */
  async function createClient(name: string): Promise<void> {
    if (!onCreateClient) return;
    await onCreateClient(name);
    setError(null);
    reset();
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
    hapticTick(); // a meeting was saved — a commit
    reset();
    setText('');
    void load();
  }

  async function remove(id: string): Promise<void> {
    if (await api.remove(id)) setMeetings((prev) => prev.filter((m) => m.id !== id));
  }

  /** Direct creation: a rep entered it deliberately, so it saves confirmed (server-side) and
   *  is immediately nudge-eligible. Client is REQUIRED — a meeting with no client can't produce
   *  a brief, which is the point of the nudge. Time is in the rep's timezone (resolved server-side). */
  async function directSave(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setDError(null);
    if (!dClient) { setDError('Choose a client — a meeting needs one to prepare a brief.'); return; }
    if (!dDate || !dTime) { setDError('A date and time are both needed.'); return; }
    const created = await api.createForClient(dClient, {
      datetime: `${dDate}T${dTime}`, // naive wall-clock; the server resolves it on the rep's zone
      datetimeRaw: `${dDate} ${dTime}`,
      title: dTitle.trim() || null,
    });
    if (!created) { setDError('Could not save the meeting.'); return; }
    hapticTick();
    setDDate(''); setDTime(''); setDTitle('');
    void load();
  }

  // NUDGE-UNCONFIRMED: an extraction-proposed meeting is shown "unconfirmed — is this right?"
  // and never nudges until the rep confirms it here (Tovira never acts on its own inference).
  async function confirmMeeting(id: string): Promise<void> {
    const done = await api.confirm(id);
    if (done) { hapticTick(); setMeetings((prev) => prev.map((m) => (m.id === id ? { ...m, confirmed: true } : m))); }
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

      {/* Direct entry (MEETING-CREATE): for anything not in a chat — a call just booked, a site
          visit agreed by phone. Confirmed by definition (the rep entered it), so no parse step. */}
      <form onSubmit={directSave} aria-label="Add a meeting directly" style={{ ...box, display: 'grid', gap: '0.5rem' }}>
        <span className="tov-stamp">Or add one directly</span>
        <select value={dClient} onChange={(e) => setDClient(e.target.value)} aria-label="Client">
          <option value="">Choose a client…</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <input type="date" value={dDate} onChange={(e) => setDDate(e.target.value)} aria-label="Meeting date" />
          <input type="time" value={dTime} onChange={(e) => setDTime(e.target.value)} aria-label="Meeting time" />
        </div>
        <input value={dTitle} onChange={(e) => setDTitle(e.target.value)} placeholder="Title (optional)" aria-label="Meeting title" />
        <button type="submit">Add meeting</button>
        {dError && <p role="alert" style={{ color: 'var(--claret)', margin: 0 }}>{dError}</p>}
      </form>

      {/* A clear proposal (parser's, or one built from a chosen candidate) → confirm. */}
      {proposal && (
        <div data-testid="meeting-preview" className="tov-deal" style={box}>
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

      {/* No match → offer to create that client (don't invent one silently). */}
      {result?.kind === 'no_client' && (
        <div style={box}>
          <p style={{ margin: '0 0 0.5rem' }}>No client matches “{result.name}”.</p>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {onCreateClient && <button onClick={() => void createClient(result.name)}>Create “{result.name}”</button>}
            <button onClick={reset}>Cancel</button>
          </div>
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
                {m.confirmed === false && (
                  <span style={{ color: 'var(--amber)', marginLeft: '0.5rem' }}> · unconfirmed — is this right?</span>
                )}
              </span>
              <span style={{ display: 'flex', gap: '0.5rem' }}>
                {m.confirmed === false && <button onClick={() => void confirmMeeting(m.id)}>Confirm</button>}
                <button onClick={() => void remove(m.id)}>Remove</button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const box: React.CSSProperties = { border: '1px solid var(--hairline)', borderRadius: 8, padding: '0.75rem 1rem', margin: '0.75rem 0' };
