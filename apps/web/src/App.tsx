import { useEffect, useState } from 'react';
import { AuthClient, type Session } from './auth/authClient.js';

const auth = new AuthClient();

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

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>
      <h1>Tovira</h1>
      <p>Signed in as {session.user.email}.</p>
      <button
        onClick={() => {
          void auth.logout().then(() => setSession(null));
        }}
      >
        Log out
      </button>
    </main>
  );
}

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
