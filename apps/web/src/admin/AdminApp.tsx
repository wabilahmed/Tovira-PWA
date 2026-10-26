import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { AdminRequestError, AdminSignedOutError, type AdminApi, type AdminStage, type AuditEntry } from './adminClient.js';
import { AccessPanel } from './AccessPanel.js';
import { CostsPanel } from './CostsPanel.js';
import { LeadsPanel } from './LeadsPanel.js';
import { Wordmark } from '../components/Wordmark.js';
import { Banner, Button, EmptyState, Page, PageHeader, TextInput } from '../ui/index.js';

/**
 * [P45-4 · owner] The admin console at /admin (phone-first, the P39 design system). Its own sign-in: password, then a
 * 6-digit code from an authenticator app (enrolled on first sign-in, with 10 recovery codes shown once). Then a small
 * nav: Leads · Access · Costs · Audit. The ops token is never asked for here.
 */
type Tab = 'leads' | 'access' | 'costs' | 'audit';
const TABS: Array<{ tab: Tab; label: string }> = [
  { tab: 'leads', label: 'Leads' }, { tab: 'access', label: 'Access' }, { tab: 'costs', label: 'Costs' }, { tab: 'audit', label: 'Audit' },
];

/** [P45-4] The former token pages now live in the console. */
export function opsRedirect(pathname: string): string | null {
  return pathname === '/ops/access' ? '/admin/access' : pathname === '/ops/costs' ? '/admin/costs' : null;
}

const tabOf = (pathname: string): Tab => (TABS.find((t) => pathname === `/admin/${t.tab}`)?.tab ?? 'leads');
const message = (err: unknown, fallback: string): string => (err instanceof AdminRequestError || err instanceof Error ? err.message : fallback);

export function AdminApp({ api }: { api: AdminApi }): JSX.Element {
  const [stage, setStage] = useState<AdminStage | 'signed_out' | 'loading'>('loading');
  const [email, setEmail] = useState('');
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [tab, setTab] = useState<Tab>(() => tabOf(window.location.pathname));
  const setupToken = window.location.pathname === '/admin/set-password' ? new URLSearchParams(window.location.search).get('token') : null;

  const refresh = useCallback(async () => {
    const me = await api.me().catch(() => null);
    if (me) setEmail(me.email);
    setStage(me ? me.stage : 'signed_out');
  }, [api]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (stage === 'ok' && !recovery && !TABS.some((t) => window.location.pathname === `/admin/${t.tab}`)) {
      window.history.replaceState({}, '', `/admin/${tab}`);
    }
  }, [stage, recovery, tab]);
  const go = (t: Tab) => { window.history.pushState({}, '', `/admin/${t}`); setTab(t); };
  const signedOut = useCallback(() => { setStage('signed_out'); }, []);

  if (stage === 'loading') return <AdminFrame><p className="ui-secondary">Loading…</p></AdminFrame>;
  if (setupToken && stage === 'signed_out') return <AdminFrame><SetPassword api={api} token={setupToken} onDone={refresh} /></AdminFrame>;
  if (stage === 'signed_out') return <AdminFrame><SignIn api={api} onDone={refresh} /></AdminFrame>;
  if (stage === 'enrol_required') return <AdminFrame><Enrol api={api} email={email} onCodes={(codes) => { setRecovery(codes); setStage('ok'); }} /></AdminFrame>;
  if (stage === 'mfa_required') return <AdminFrame><VerifyMfa api={api} onDone={refresh} /></AdminFrame>;
  if (recovery) return <AdminFrame><RecoveryCodes codes={recovery} onDone={() => { setRecovery(null); window.history.replaceState({}, '', `/admin/${tab}`); }} /></AdminFrame>;

  return (
    <AdminFrame>
      <nav aria-label="Admin" className="ui-cluster ui-gap-3" style={{ marginBottom: 'var(--space-4)', flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <a key={t.tab} href={`/admin/${t.tab}`} aria-current={tab === t.tab ? 'page' : undefined} className={`ui-chip${tab === t.tab ? ' ui-chip--on' : ''}`}
            onClick={(e) => { e.preventDefault(); go(t.tab); }}>{t.label}</a>
        ))}
        <span style={{ marginLeft: 'auto' }} />
        <Button variant="text" size="sm" onClick={() => void api.logout().catch(() => undefined).finally(() => setStage('signed_out'))}>Sign out</Button>
      </nav>
      {tab === 'leads' && <LeadsPanel api={api} onSignedOut={signedOut} />}
      {tab === 'access' && <AccessPanel api={api} onSignedOut={signedOut} />}
      {tab === 'costs' && <CostsPanel api={api} onSignedOut={signedOut} />}
      {tab === 'audit' && <AuditPanel api={api} onSignedOut={signedOut} />}
    </AdminFrame>
  );
}

function AdminFrame({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <Page testId="admin-page" label="Tovira admin">
      <div style={{ maxWidth: 1200, margin: '0 auto', width: '100%' }}>
        <p style={{ fontFamily: 'var(--font-display)', fontWeight: 600, margin: '0 0 var(--space-3)' }}><Wordmark /> <span className="ui-caption">admin</span></p>
        {children}
      </div>
    </Page>
  );
}

function SignIn({ api, onDone }: { api: AdminApi; onDone: () => void }): JSX.Element {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault(); setError(null); setBusy(true);
    try { await api.login(email.trim(), password); onDone(); } catch (err) { setError(message(err, 'Sign-in failed.')); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={(e) => void submit(e)} className="ui-stack ui-gap-3" style={{ maxWidth: 420 }}>
      <PageHeader title="Admin sign-in" />
      {error && <Banner tone="danger">{error}</Banner>}
      <TextInput label="Email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
      <TextInput label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      <Button variant="primary" type="submit" loading={busy}>Sign in</Button>
    </form>
  );
}

function SetPassword({ api, token, onDone }: { api: AdminApi; token: string; onDone: () => void }): JSX.Element {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault(); setError(null);
    try { await api.setPassword(token, password); window.history.replaceState({}, '', '/admin'); onDone(); } catch (err) { setError(message(err, 'That did not work.')); }
  }
  return (
    <form onSubmit={(e) => void submit(e)} className="ui-stack ui-gap-3" style={{ maxWidth: 420 }}>
      <PageHeader title="Set your admin password" subtitle="At least 12 characters. Next you will add an authenticator app." />
      {error && <Banner tone="danger">{error}</Banner>}
      <TextInput label="New password" type="password" autoComplete="new-password" minLength={12} value={password} onChange={(e) => setPassword(e.target.value)} required />
      <Button variant="primary" type="submit">Set password</Button>
    </form>
  );
}

function Enrol({ api, email, onCodes }: { api: AdminApi; email: string; onCodes: (codes: string[]) => void }): JSX.Element {
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void api.enrolStart().then(setSetup).catch((err) => setError(message(err, 'Could not start two-factor setup.'))); }, [api]);
  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault(); setError(null);
    try { onCodes(await api.enrolConfirm(code.trim())); } catch (err) { setError(message(err, 'That code is not right.')); }
  }
  return (
    <form onSubmit={(e) => void submit(e)} className="ui-stack ui-gap-3" style={{ maxWidth: 480 }}>
      <PageHeader title="Turn on two-factor" subtitle={`Add Tovira admin (${email}) to an authenticator app, then enter the code it shows.`} />
      {error && <Banner tone="danger">{error}</Banner>}
      {setup && (
        <>
          <a href={setup.otpauthUrl} className="ui-btn ui-btn--secondary">Open in your authenticator app</a>
          <p className="ui-secondary">Or type this key into the app:</p>
          <p className="tov-mono" style={{ fontSize: 'var(--text-title-size)', letterSpacing: '0.08em', overflowWrap: 'anywhere' }}>{setup.secret.replace(/(.{4})/g, '$1 ').trim()}</p>
        </>
      )}
      <TextInput label="6-digit code from the app" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} required />
      <Button variant="primary" type="submit" disabled={!setup}>Turn on two-factor</Button>
    </form>
  );
}

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }): JSX.Element {
  return (
    <div className="ui-stack ui-gap-3" style={{ maxWidth: 480 }}>
      <PageHeader title="Your recovery codes" subtitle="Each one signs you in once if you lose your phone. They are shown only now: save them somewhere safe." />
      <ul data-testid="recovery-codes" className="tov-mono" style={{ columns: 2, padding: 0, listStyle: 'none', fontSize: 'var(--text-body-size)' }}>
        {codes.map((c) => <li key={c}>{c}</li>)}
      </ul>
      <Button variant="primary" onClick={onDone}>I have saved these codes</Button>
    </div>
  );
}

function VerifyMfa({ api, onDone }: { api: AdminApi; onDone: () => void }): JSX.Element {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault(); setError(null);
    try { await api.verifyMfa(code.trim()); onDone(); } catch (err) { setError(message(err, 'That code is not right.')); }
  }
  return (
    <form onSubmit={(e) => void submit(e)} className="ui-stack ui-gap-3" style={{ maxWidth: 420 }}>
      <PageHeader title="Two-factor" subtitle="Enter the code from your authenticator app." />
      {error && <Banner tone="danger">{error}</Banner>}
      <TextInput label="6-digit code or a recovery code" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} required />
      <Button variant="primary" type="submit">Verify</Button>
    </form>
  );
}

const ACTION_LABEL: Record<string, string> = {
  'access.approve': 'Approved access', 'access.reject': 'Rejected access', 'access.reinvite': 'Re-sent an invite',
  'lead.status': 'Changed a lead status', 'lead.notes': 'Edited lead notes', 'lead.invite_to_beta': 'Invited a lead to the beta',
  'leads.csv_export': 'Exported leads (CSV)', 'costs.csv_export': 'Exported costs (CSV)',
  'admin.sign_in': 'Signed in', 'admin.sign_in_password': 'Password accepted', 'admin.sign_in_recovery_code': 'Signed in with a recovery code',
  'admin.2fa_enrolled': 'Turned on two-factor', 'admin.created': 'Admin account created', 'admin.reinvited': 'Admin link re-sent',
};

function AuditPanel({ api, onSignedOut }: { api: Pick<AdminApi, 'audit'>; onSignedOut: () => void }): JSX.Element {
  const [log, setLog] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.audit().then(setLog).catch((err) => { if (err instanceof AdminSignedOutError) onSignedOut(); else setError(message(err, 'Could not load the audit log.')); });
  }, [api, onSignedOut]);
  return (
    <>
      <PageHeader title="Audit" subtitle="Every admin action: who, what, when." />
      {error && <Banner tone="danger">{error}</Banner>}
      {log === null ? <p className="ui-secondary">Loading…</p> : log.length === 0 ? <EmptyState title="Nothing yet." /> : (
        <ul className="ui-stack ui-gap-2" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {log.map((e, i) => (
            <li key={i} data-testid={`audit-${i}`} className="ui-card" style={{ padding: 'var(--space-3)', gap: 'var(--space-1)' }}>
              <strong>{ACTION_LABEL[e.action] ?? e.action}{e.target ? `: ${e.target}` : ''}</strong>
              <span className="ui-caption">{e.adminEmail} · {new Date(e.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
              {e.detail && Object.keys(e.detail).length > 0 && <span className="ui-caption">{Object.entries(e.detail).map(([k, v]) => `${k}: ${String(v)}`).join(' · ')}</span>}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
