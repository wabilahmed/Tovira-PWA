import { useEffect, useState } from 'react';
import { AuthClient, type Session } from './auth/authClient.js';
import { ClientsClient, type ClientSummary, type NoteSummary, type Brief } from './clients/clientsClient.js';
import { Outbox, type PendingRecording } from './capture/outbox.js';
import { IdbRecordingStore } from './capture/idbRecordingStore.js';
import { HttpUploader } from './capture/uploader.js';
import { requestMicrophone } from './capture/microphone.js';
import { startRecording, type ActiveRecording } from './capture/recorder.js';

const auth = new AuthClient();
const clientsApi = new ClientsClient();
const outbox = new Outbox(new IdbRecordingStore(), new HttpUploader());

function randomId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Math.random());
}

export function App(): JSX.Element {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    // On load / refresh: ask the server who we are. Cookie → still logged in.
    auth
      .getSession()
      .then(setSession)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Centered>Loading…</Centered>;
  if (!session) return <LoginScreen onAuthed={setSession} />;

  return <ClientsScreen session={session} onLogout={() => void auth.logout().then(() => setSession(null))} />;
}

function ClientsScreen({ session, onLogout }: { session: Session; onLogout: () => void }): JSX.Element {
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [name, setName] = useState('');
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<ClientSummary | null>(null);

  // Reload (with the current search) whenever the query changes — recents first.
  useEffect(() => {
    void clientsApi.list(query.trim() || undefined).then(setClients);
  }, [query]);

  if (open) return <ClientDetail client={open} onBack={() => setOpen(null)} />;

  async function addClient(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const created = await clientsApi.create(name);
      setClients((prev) => [created, ...prev]);
      setName('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create client.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem', maxWidth: 640, margin: '0 auto' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h1 style={{ margin: 0 }}>Tovira</h1>
        <small>
          {session.user.email} · <button onClick={onLogout} style={linkButton}>Log out</button>
        </small>
      </header>

      <form onSubmit={addClient} style={{ display: 'flex', gap: '0.5rem', margin: '1.5rem 0' }}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New client name"
          aria-label="New client name"
          style={{ flex: 1 }}
        />
        <button type="submit" disabled={busy}>Add client</button>
      </form>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}

      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search clients…"
        aria-label="Search clients"
        style={{ width: '100%', marginBottom: '1rem' }}
      />

      {clients.length === 0 ? (
        <p style={{ color: '#666' }}>
          {query.trim() ? `No clients match “${query.trim()}”.` : 'No clients yet. Add your first one above.'}
        </p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {clients.map((c) => (
            <li key={c.id} style={{ borderBottom: '1px solid #eee' }}>
              <button onClick={() => setOpen(c)} style={{ ...linkButton, display: 'block', width: '100%', textAlign: 'left', padding: '0.75rem 0', color: 'inherit' }}>
                {c.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function ClientDetail({ client, onBack }: { client: ClientSummary; onBack: () => void }): JSX.Element {
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [pending, setPending] = useState<PendingRecording[]>([]);
  const [active, setActive] = useState<ActiveRecording | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [paste, setPaste] = useState('');
  const [brief, setBrief] = useState<Brief | null>(null);

  const refresh = (): void => {
    void clientsApi.listNotes(client.id).then(async (list) => {
      setNotes(list);
      // Advance any notes through the pipeline: transcribe, then extract.
      const toTranscribe = list.filter((n) => n.status === 'pending_transcription');
      const toExtract = list.filter((n) => n.status === 'pending_extraction');
      if (toTranscribe.length > 0 || toExtract.length > 0) {
        await Promise.all([
          ...toTranscribe.map((n) => clientsApi.transcribeNote(n.id)),
          ...toExtract.map((n) => clientsApi.extractNote(n.id)),
        ]);
        setNotes(await clientsApi.listNotes(client.id));
      }
    });
    void outbox.pending().then(setPending);
  };
  useEffect(() => {
    void outbox.flush().then(refresh);
  }, []);

  async function startRec(): Promise<void> {
    setStatus(null);
    const mic = await requestMicrophone();
    if (!mic.granted || !mic.stream) {
      setStatus(mic.guidance ?? 'Microphone unavailable.');
      return;
    }
    setActive(startRecording(mic.stream));
  }

  async function stopRec(): Promise<void> {
    if (!active) return;
    const blob = await active.stop();
    setActive(null);
    await outbox.enqueue({ id: randomId(), clientId: client.id, blob, createdAt: Date.now() });
    refresh();
  }

  async function savePaste(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!paste.trim()) return;
    setStatus(null);
    try {
      await clientsApi.createPasteNote(client.id, paste);
      setPaste('');
      refresh();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Could not save the message.');
    }
  }

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem', maxWidth: 640, margin: '0 auto' }}>
      <button onClick={onBack} style={linkButton}>← Clients</button>
      <h1>{client.name}</h1>

      <button onClick={() => void clientsApi.getBrief(client.id).then(setBrief)}>Pre-meeting brief</button>
      {brief && <BriefPanel brief={brief} />}

      {active ? (
        <button onClick={() => void stopRec()}>■ Stop &amp; save</button>
      ) : (
        <button onClick={() => void startRec()}>● Record voice note</button>
      )}

      <form onSubmit={savePaste} style={{ marginTop: '1rem' }}>
        <textarea
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          placeholder="Paste a message (WhatsApp, email…)"
          aria-label="Paste a message"
          rows={3}
          style={{ width: '100%' }}
        />
        <button type="submit" disabled={!paste.trim()}>Save message</button>
      </form>

      {status && <p style={{ color: 'crimson' }}>{status}</p>}
      {pending.length > 0 && (
        <p style={{ color: '#a15c00' }}>
          {pending.length} recording(s) pending upload — they’re saved and will retry automatically.
        </p>
      )}

      <h2 style={{ fontSize: '1rem', marginTop: '1.5rem' }}>Notes</h2>
      {notes.length === 0 ? (
        <p style={{ color: '#666' }}>No notes yet.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {notes.map((n) => (
            <li key={n.id} style={{ padding: '0.5rem 0', borderBottom: '1px solid #eee' }}>
              <small style={{ color: '#888' }}>
                {new Date(n.createdAt).toLocaleString()} · {n.source}
                {isProcessing(n.status) && <em style={{ color: '#a15c00' }}> · {processingLabel(n.status)}</em>}
              </small>
              <div>{n.rawText ?? <em>(transcription pending)</em>}</div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

const linkButton: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#2563eb',
  cursor: 'pointer',
  padding: 0,
  font: 'inherit',
};

function LoginScreen({ onAuthed }: { onAuthed: (s: Session) => void }): JSX.Element {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const session = mode === 'login' ? await auth.login(email, password) : await auth.signup(email, password);
      onAuthed(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Centered>
      <form onSubmit={submit} style={{ display: 'grid', gap: '0.75rem', width: 280 }}>
        <h1 style={{ margin: 0 }}>Tovira</h1>
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          />
        </label>
        {error && <p style={{ color: 'crimson', margin: 0 }}>{error}</p>}
        <button type="submit" disabled={busy}>
          {mode === 'login' ? 'Log in' : 'Create account'}
        </button>
        <button type="button" onClick={() => setMode(mode === 'login' ? 'signup' : 'login')} style={{ background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer' }}>
          {mode === 'login' ? 'Need an account? Sign up' : 'Have an account? Log in'}
        </button>
      </form>
    </Centered>
  );
}

function BriefPanel({ brief }: { brief: Brief }): JSX.Element {
  if (brief.empty) {
    return (
      <section style={briefBox}>
        <p style={{ color: '#666', margin: 0 }}>Nothing logged yet for {brief.clientName}. Capture a note to build a brief.</p>
      </section>
    );
  }
  return (
    <section style={briefBox}>
      <h2 style={{ fontSize: '1rem', marginTop: 0 }}>Brief</h2>
      {brief.openPromises.length > 0 && (
        <div>
          <strong>Open promises</strong>
          <ul>{brief.openPromises.map((p) => <li key={p.id}>{p.text}{p.dueDate ? ` (due ${p.dueDate})` : p.dueRaw ? ` (${p.dueRaw})` : ''}</li>)}</ul>
        </div>
      )}
      {brief.needsConfirmation.length > 0 && (
        <div>
          <strong style={{ color: '#a15c00' }}>To confirm (not yet facts)</strong>
          <ul>{brief.needsConfirmation.map((p) => <li key={p.id}>{p.text}</li>)}</ul>
        </div>
      )}
      {brief.keyPeople.length > 0 && (
        <div>
          <strong>Key people</strong>
          <ul>{brief.keyPeople.map((p, i) => <li key={i}>{p.name}{p.role ? `, ${p.role}` : ''} — {p.decision_role.replace('_', ' ')}</li>)}</ul>
        </div>
      )}
      {brief.concerns.length > 0 && (
        <div><strong>Concerns</strong><ul>{brief.concerns.map((c, i) => <li key={i}>{c}</li>)}</ul></div>
      )}
      {brief.personalNotes.length > 0 && (
        <div><strong>Personal notes</strong><ul>{brief.personalNotes.map((f, i) => <li key={i}>{f.subject}: {f.fact}</li>)}</ul></div>
      )}
    </section>
  );
}

function isProcessing(status: string): boolean {
  return status === 'pending_transcription' || status === 'pending_extraction';
}
function processingLabel(status: string): string {
  return status === 'pending_transcription' ? 'transcribing…' : 'analysing…';
}

const briefBox: React.CSSProperties = {
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  padding: '1rem',
  margin: '1rem 0',
  background: '#fafafa',
};

function Centered({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
      {children}
    </div>
  );
}
