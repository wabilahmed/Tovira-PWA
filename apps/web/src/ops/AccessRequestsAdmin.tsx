import { useCallback, useEffect, useState } from 'react';
import { OpsUnauthorizedError, type OpsAccessApi, type OpsAccessRequest, type OpsAccessStatus } from './opsAccessClient.js';
import { Wordmark } from '../components/Wordmark.js';

/**
 * [P33] /ops/access — the owner reviews beta access requests here instead of with curl. The page holds no
 * credential: the owner types the ops token (OPS_TOKEN), it is kept for THIS TAB only (sessionStorage), and
 * every call sends it; the API refuses everything without it. Approve = account + single-use invite email;
 * Reject = status + note, no email; Re-invite = a fresh link to the original address (old links stop working).
 */
const TOKEN_KEY = 'tovira.opsToken';
const readToken = (): string | null => { try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; } };
const writeToken = (t: string | null): void => {
  try { if (t) sessionStorage.setItem(TOKEN_KEY, t); else sessionStorage.removeItem(TOKEN_KEY); } catch { /* private mode: keep in memory only */ }
};

const OWNERSHIP: Record<string, string> = { owns_or_manages: 'Owns or manages the company', employed: 'Employed by the company' };
const CONVERSATIONS: Record<string, string> = {
  own_clients: 'Their own clients', brokerage_i_manage: 'Clients of a brokerage they own or manage',
  brokerage_employs_me: 'Clients of the brokerage that employs them', mix: 'A mix', other: 'Other',
};
const VOLUME: Record<string, string> = { under_50: 'Under 50', '50_200': '50–200', '200_500': '200–500', '500_plus': '500+' };
const STATUS_LABEL: Record<OpsAccessStatus, string> = { pending: 'Pending', approved: 'Approved', invited: 'Invited', activated: 'Activated', rejected: 'Rejected' };

function fmt(ms: number): string {
  return new Date(ms).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function AccessRequestsAdmin({ api }: { api: OpsAccessApi }): JSX.Element {
  const [token, setToken] = useState<string | null>(() => readToken());
  const [draft, setDraft] = useState('');
  const [filter, setFilter] = useState<'pending' | 'all'>('pending');
  const [requests, setRequests] = useState<OpsAccessRequest[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refused = useCallback(() => {
    writeToken(null);
    setToken(null);
    setRequests(null);
    setError('That ops token was refused. Check OPS_TOKEN in tovira/prod/app and try again.');
  }, []);

  const load = useCallback(async (t: string, f: 'pending' | 'all') => {
    setError(null);
    try {
      setRequests(await api.list(t, f === 'pending' ? 'pending' : undefined));
    } catch (err) {
      if (err instanceof OpsUnauthorizedError) refused();
      else setError(err instanceof Error ? err.message : 'Could not load requests.');
    }
  }, [api, refused]);

  useEffect(() => { if (token) void load(token, filter); }, [token, filter, load]);

  async function act(r: OpsAccessRequest, kind: 'approve' | 'reject' | 'reinvite'): Promise<void> {
    if (!token) return;
    let note = '';
    if (kind === 'approve' && !window.confirm(`Approve ${r.fullName} (${r.workEmail})? This creates their account and emails the invite.`)) return;
    if (kind === 'reject') {
      const n = window.prompt(`Reject ${r.fullName}? Optional note (kept internally, not emailed):`, '');
      if (n === null) return;
      note = n;
    }
    if (kind === 'reinvite' && !window.confirm(`Send ${r.fullName} a new invite link? Earlier links stop working.`)) return;
    setBusy(r.id);
    setNotice(null);
    setError(null);
    try {
      if (kind === 'approve') { await api.approve(token, r.id); setNotice(`Approved — invite emailed to ${r.workEmail}.`); }
      if (kind === 'reject') { await api.reject(token, r.id, note); setNotice(`Rejected ${r.fullName}. No email was sent.`); }
      if (kind === 'reinvite') { await api.reinvite(token, r.id); setNotice(`New invite emailed to ${r.workEmail}.`); }
      await load(token, filter);
    } catch (err) {
      if (err instanceof OpsUnauthorizedError) refused();
      else setError(err instanceof Error ? err.message : 'That did not work.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="standard" style={{ maxWidth: 760, margin: '0 auto', padding: '24px 16px' }}>
      <p style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: '1.4rem', margin: 0 }}><Wordmark /></p>
      <h1 style={{ fontSize: '1.2rem', margin: '0.5rem 0 1rem' }}>Beta access requests</h1>
      {notice && <p role="status" style={{ color: 'var(--green)' }}>{notice}</p>}
      {error && <p role="alert" style={{ color: 'var(--claret)' }}>{error}</p>}

      {!token ? (
        <form onSubmit={(e) => { e.preventDefault(); const t = draft.trim(); if (!t) return; writeToken(t); setToken(t); setDraft(''); }}>
          <label htmlFor="ops-token" style={{ display: 'block', marginBottom: 6 }}>Ops token</label>
          <input id="ops-token" type="password" autoComplete="off" value={draft} onChange={(e) => setDraft(e.target.value)} style={{ width: '100%', maxWidth: 420 }} />
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>The OPS_TOKEN value from Secrets Manager (tovira/prod/app). Kept for this tab only.</p>
          <button type="submit" className="tov-button">Open</button>
        </form>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
            <button className="tov-link" aria-pressed={filter === 'pending'} onClick={() => setFilter('pending')}>Pending</button>
            <button className="tov-link" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>All</button>
            <button className="tov-link" onClick={() => void load(token, filter)}>Refresh</button>
            <button className="tov-link" style={{ marginLeft: 'auto' }} onClick={() => { writeToken(null); setToken(null); setRequests(null); }}>Lock</button>
          </div>
          {requests === null ? <p>Loading…</p> : requests.length === 0 ? (
            <p>{filter === 'pending' ? 'No pending requests.' : 'No requests yet.'}</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 12 }}>
              {requests.map((r) => (
                <li key={r.id} data-testid={`request-${r.id}`} style={{ border: '1px solid var(--hairline)', borderRadius: 6, padding: 14, background: 'var(--surface-raised)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                    <strong>{r.fullName}</strong>
                    <span className="tov-mono" style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{STATUS_LABEL[r.status]} · {fmt(r.createdAt)}</span>
                  </div>
                  <p style={{ margin: '6px 0' }}>{r.roleTitle}, {r.companyName}</p>
                  <p style={{ margin: '2px 0' }}><a href={`mailto:${r.workEmail}`}>{r.workEmail}</a> · <a href={`tel:${r.phone}`}>{r.phone}</a></p>
                  <p style={{ margin: '2px 0', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                    {OWNERSHIP[r.ownership] ?? r.ownership}{r.tradeLicenceNumber ? ` · trade licence ${r.tradeLicenceNumber}` : ''} · conversations: {CONVERSATIONS[r.conversationOwnership] ?? r.conversationOwnership}
                    {r.conversationOwnershipOther ? ` (${r.conversationOwnershipOther})` : ''} · volume: {VOLUME[r.expectedVolume] ?? r.expectedVolume}
                  </p>
                  {r.ownership === 'employed' && r.status === 'pending' && (
                    <p style={{ margin: '6px 0', color: 'var(--amber)' }}>Employed — ask for the company NOC before approving.</p>
                  )}
                  {r.reviewedNote && <p style={{ margin: '6px 0', fontSize: '0.9rem' }}>Note: {r.reviewedNote}</p>}
                  <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                    {r.status === 'pending' && (
                      <>
                        <button className="tov-button" disabled={busy === r.id} onClick={() => void act(r, 'approve')}>Approve</button>
                        <button className="tov-link" disabled={busy === r.id} onClick={() => void act(r, 'reject')}>Reject</button>
                      </>
                    )}
                    {r.status === 'invited' && (
                      <button className="tov-link" disabled={busy === r.id} onClick={() => void act(r, 'reinvite')}>Re-invite</button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </main>
  );
}
