import { useCallback, useEffect, useState } from 'react';
import { AdminSignedOutError, type AdminApi, type FreeAccessAccount } from './adminClient.js';
import { Banner, Button, EmptyState, PageHeader, TextInput } from '../ui/index.js';

/**
 * [P72-2 · owner] Admin → Access → Free access. Type the email of an existing account and press Give free access:
 * the account is paid until revoked, with no Stripe subscription behind it (their Subscription page says "Free access
 * from Tovira"). The same spend cap applies. Revoke asks first. Every grant and revoke is in the audit log.
 */
function fmt(ms: number): string {
  return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function FreeAccessPanel({ api, onSignedOut }: { api: Pick<AdminApi, 'freeAccessList' | 'grantFreeAccess' | 'revokeFreeAccess'>; onSignedOut: () => void }): JSX.Element {
  const [accounts, setAccounts] = useState<FreeAccessAccount[] | null>(null);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fail = useCallback((err: unknown, fallback: string) => {
    if (err instanceof AdminSignedOutError) onSignedOut();
    else setError(err instanceof Error ? err.message : fallback);
  }, [onSignedOut]);
  const load = useCallback(async () => {
    try { setAccounts(await api.freeAccessList()); } catch (err) { fail(err, 'Could not load free access.'); }
  }, [api, fail]);
  useEffect(() => { void load(); }, [load]);

  async function give(): Promise<void> {
    setBusy(true); setNotice(null); setError(null);
    try {
      const a = await api.grantFreeAccess(email.trim());
      setNotice(`${a.email} now has free access until you revoke it.`);
      setEmail('');
      await load();
    } catch (err) { fail(err, 'That did not work.'); } finally { setBusy(false); }
  }

  async function revoke(a: FreeAccessAccount): Promise<void> {
    if (!window.confirm(`Revoke free access for ${a.email}? Their account goes back to what it was before (for example, an ended trial).`)) return;
    setBusy(true); setNotice(null); setError(null);
    try {
      await api.revokeFreeAccess(a.email);
      setNotice(`Free access revoked for ${a.email}.`);
      await load();
    } catch (err) { fail(err, 'That did not work.'); } finally { setBusy(false); }
  }

  return (
    <section aria-label="Free access">
      <PageHeader title="Free access" subtitle="Paid until you revoke it, with no Stripe subscription. The same spend cap applies." />
      {notice && <Banner tone="success">{notice}</Banner>}
      {error && <Banner tone="danger">{error}</Banner>}
      <form onSubmit={(e) => { e.preventDefault(); if (email.trim()) void give(); }} style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <TextInput label="Account email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
        <Button variant="primary" type="submit" disabled={busy || !email.trim()}>Give free access</Button>
      </form>
      {accounts === null ? <p className="ui-secondary">Loading…</p> : accounts.length === 0 ? (
        <EmptyState title="Nobody has free access." />
      ) : (
        <ul className="ui-list">
          {accounts.map((a) => (
            <li key={a.email} data-testid="free-access-row" className="ui-list__row" style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-2)', alignItems: 'center' }}>
              <span>
                <strong>{a.email}</strong>
                <span className="ui-secondary"> · since {fmt(a.since)} · given by {a.by}</span>
              </span>
              <Button size="sm" disabled={busy} onClick={() => void revoke(a)}>Revoke</Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
