import { hapticTick } from '../haptics.js';
import { useEffect, useState } from 'react';
import type { Meeting, ParseResult } from './meetingsClient.js';
import { formatDateTime } from '../format/dates.js';
import { Page, PageHeader } from '../ui/PageHeader.js';

export interface MeetingsApi {
  list(): Promise<Meeting[]>;
  parse(text: string): Promise<ParseResult | null>;
  createForClient(clientId: string, meeting: { datetime: string | null; datetimeRaw: string; title: string | null }): Promise<Meeting | null>;
  remove(id: string): Promise<boolean>;
  confirm(id: string): Promise<Meeting | null>;
  edit(id: string, patch: { datetime?: string | null; datetimeRaw?: string; title?: string | null }): Promise<Meeting | null>;
}

/** A proposal ready to save — either the parser's own proposal, or one the rep
 *  built by choosing among ambiguous candidates. */
interface Proposal { clientId: string; datetime: string | null; datetimeRaw: string; }

export interface ClientOption {
  id: string;
  name: string;
}

/** Meetings (P3-1): add via natural language, CONFIRMED before saving, plus list. */
export function Meetings({ api, clients, onCreateClient, timeZone }: { api: MeetingsApi; clients: ClientOption[]; onCreateClient?: (name: string) => Promise<ClientOption>; timeZone?: string }): JSX.Element {
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

  // [AUDIT item 2] Reschedule in place (keeps the receipt). The naive wall-clock value is resolved on
  // the rep's timezone server-side; the returned meeting carries the resolved time.
  async function editTime(id: string, value: string): Promise<void> {
    if (!value) return;
    const updated = await api.edit(id, { datetime: value, datetimeRaw: value.replace('T', ' ') });
    if (updated) { hapticTick(); setMeetings((prev) => prev.map((m) => (m.id === id ? updated : m))); }
  }

  return (
    <Page testId="meetings-page" label="Meetings">
      <PageHeader title="Meetings" />

      <form onSubmit={doParse} style={{ display: 'flex', gap: 'var(--space-2)' }}>
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
      <form onSubmit={directSave} aria-label="Add a meeting directly" style={{ ...box, display: 'grid', gap: 'var(--space-2)' }}>
        <span className="tov-stamp">Or add one directly</span>
        <select className="tov-client-select" value={dClient} onChange={(e) => setDClient(e.target.value)} aria-label="Client">
          <option value="">Choose a client…</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
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
            {proposal.datetime ? ` (${formatDateTime(proposal.datetime, timeZone)})` : ' (time unconfirmed)'}
          </p>
          <label>
            With{' '}
            <select className="tov-client-select" value={clientId} onChange={(e) => setClientId(e.target.value)} aria-label="Meeting client">
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
          <div style={{ marginTop: 'var(--space-2)', display: 'flex', gap: 'var(--space-2)' }}>
            <button onClick={() => void confirm()} disabled={!clientId}>Save meeting</button>
            <button onClick={reset}>Cancel</button>
          </div>
        </div>
      )}

      {/* Ambiguous name → ASK which client (never silently pick one). */}
      {result?.kind === 'ambiguous_client' && !proposal && (
        <div style={box}>
          <p style={{ margin: '0 0 var(--space-2)' }}>Which client did you mean for <strong>{result.datetimeRaw}</strong>?</p>
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
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
          <p style={{ margin: '0 0 var(--space-2)' }}>No client matches “{result.name}”.</p>
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
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
            <li key={m.id} data-testid="meeting" style={{ ...box, display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'baseline', gap: 'var(--space-2)' }}>
              <span style={{ minWidth: 0, flex: '1 1 12rem' }}>
                {m.title ?? 'Meeting'} with {nameOf(m.clientId)} — <small className="tov-stamp">{m.datetime ? formatDateTime(m.datetime, timeZone) : m.datetimeRaw}</small>
                {m.confirmed === false && (
                  <span style={{ color: 'var(--amber)', marginLeft: 'var(--space-2)' }}> · unconfirmed — is this right?</span>
                )}
              </span>
              <span style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', alignItems: 'center' }}>
                <input
                  type="datetime-local"
                  aria-label={`Reschedule ${m.title ?? 'meeting'}`}
                  value={(m.datetime ?? '').slice(0, 16)}
                  onChange={(e) => void editTime(m.id, e.target.value)}
                  style={{ maxWidth: '100%' }}
                />
                {m.confirmed === false && <button onClick={() => void confirmMeeting(m.id)}>Confirm</button>}
                <button onClick={() => void remove(m.id)}>Remove</button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}

const box: React.CSSProperties = { border: '1px solid var(--hairline)', borderRadius: 8, padding: 'var(--space-3) var(--space-4)', margin: 'var(--space-3) 0' };
