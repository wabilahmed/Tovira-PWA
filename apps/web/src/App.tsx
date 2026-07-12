import { useEffect, useState } from 'react';
import { AuthClient, type Session } from './auth/authClient.js';
import { ClientsClient, type ClientSummary } from './clients/clientsClient.js';

const auth = new AuthClient();
const clientsApi = new ClientsClient();

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

  // Reload (with the current search) whenever the query changes — recents first.
  useEffect(() => {
    void clientsApi.list(query.trim() || undefined).then(setClients);
  }, [query]);

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
            <li key={c.id} style={{ padding: '0.75rem 0', borderBottom: '1px solid #eee' }}>
              {c.name}
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

function Centered({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
      {children}
    </div>
  );
}
