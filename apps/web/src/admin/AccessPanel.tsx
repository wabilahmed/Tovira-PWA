import { useCallback, useEffect, useState } from 'react';
import { AdminSignedOutError, type AccessRequest, type AccessStatus, type AdminApi } from './adminClient.js';
import { Badge, Banner, Button, Chip, ChipGroup, EmptyState, PageHeader } from '../ui/index.js';

/**
 * [P33 → P45-4] The beta access requests, in the admin console (admin session; no ops token). Unchanged behaviour:
 * Pending by default or All; Approve (after a confirm) creates the account and emails the invite; Reject records a
 * note (no email); Re-invite sends a fresh link (earlier links stop working); an employed applicant is flagged for
 * the company NOC; each request shows its Industry. A request made from a hot lead shows "Not asked" for the form's
 * questions (the lead never answered them).
 */
const OWNERSHIP: Record<string, string> = { owns_or_manages: 'Owns or manages the company', employed: 'Employed by the company' };
const CONVERSATIONS: Record<string, string> = {
  own_clients: 'Their own clients', brokerage_i_manage: 'Clients of a company they own or manage',
  brokerage_employs_me: 'Clients of the company that employs them', mix: 'A mix', other: 'Other',
};
const INDUSTRY: Record<string, string> = {
  insurance: 'Insurance', wealth_private_banking: 'Wealth / private banking', b2b_key_accounts: 'B2B / key accounts',
  luxury_client_advisory: 'Luxury / client advisory', recruitment: 'Recruitment', property: 'Property', other: 'Other',
};
const VOLUME: Record<string, string> = { under_50: 'Under 50', '50_200': '50–200', '200_500': '200–500', '500_plus': '500+' };
const STATUS_LABEL: Record<AccessStatus, string> = { pending: 'Pending', approved: 'Approved', invited: 'Invited', activated: 'Activated', rejected: 'Rejected' };
const NOT_ASKED = 'Not asked';

function fmt(ms: number): string {
  return new Date(ms).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function AccessPanel({ api, onSignedOut }: { api: Pick<AdminApi, 'accessList' | 'approve' | 'reject' | 'reinvite'>; onSignedOut: () => void }): JSX.Element {
  const [filter, setFilter] = useState<'pending' | 'all'>('pending');
  const [requests, setRequests] = useState<AccessRequest[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fail = useCallback((err: unknown, fallback: string) => {
    if (err instanceof AdminSignedOutError) onSignedOut();
    else setError(err instanceof Error ? err.message : fallback);
  }, [onSignedOut]);
  const load = useCallback(async (f: 'pending' | 'all') => {
    setError(null);
    try { setRequests(await api.accessList(f === 'pending' ? 'pending' : undefined)); } catch (err) { fail(err, 'Could not load requests.'); }
  }, [api, fail]);
  useEffect(() => { void load(filter); }, [filter, load]);

  async function act(r: AccessRequest, kind: 'approve' | 'reject' | 'reinvite'): Promise<void> {
    let note = '';
    if (kind === 'approve' && !window.confirm(`Approve ${r.fullName} (${r.workEmail})? This creates their account and emails the invite.`)) return;
    if (kind === 'reject') {
      const n = window.prompt(`Reject ${r.fullName}? Optional note (kept internally, not emailed):`, '');
      if (n === null) return;
      note = n;
    }
    if (kind === 'reinvite' && !window.confirm(`Send ${r.fullName} a new invite link? Earlier links stop working.`)) return;
    setBusy(r.id); setNotice(null); setError(null);
    try {
      if (kind === 'approve') { await api.approve(r.id); setNotice(`Approved. Invite emailed to ${r.workEmail}.`); }
      if (kind === 'reject') { await api.reject(r.id, note); setNotice(`Rejected ${r.fullName}. No email was sent.`); }
      if (kind === 'reinvite') { await api.reinvite(r.id); setNotice(`New invite emailed to ${r.workEmail}.`); }
      await load(filter);
    } catch (err) { fail(err, 'That did not work.'); } finally { setBusy(null); }
  }

  return (
    <>
      <PageHeader title="Access requests" subtitle="Who asked to join the beta." />
      {notice && <Banner tone="success">{notice}</Banner>}
      {error && <Banner tone="danger">{error}</Banner>}
      <ChipGroup label="Show">
        <Chip selected={filter === 'pending'} onClick={() => setFilter('pending')}>Pending</Chip>
        <Chip selected={filter === 'all'} onClick={() => setFilter('all')}>All</Chip>
      </ChipGroup>
      {requests === null ? <p className="ui-secondary">Loading…</p> : requests.length === 0 ? (
        <EmptyState title={filter === 'pending' ? 'No pending requests.' : 'No requests yet.'} />
      ) : (
        <ul className="ui-stack ui-gap-3" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {requests.map((r) => (
            <li key={r.id} data-testid={`request-${r.id}`} className="ui-card" style={{ padding: 'var(--space-4)' }}>
              <div className="ui-cluster ui-cluster--between ui-gap-2">
                <strong>{r.fullName}</strong>
                <span className="ui-caption">{STATUS_LABEL[r.status]} · {fmt(r.createdAt)}</span>
              </div>
              {r.source === 'hot_lead' && <Badge tone="accent">From a hot lead</Badge>}
              <p style={{ margin: 'var(--space-2) 0' }}>{[r.roleTitle, r.companyName].filter(Boolean).join(', ')}</p>
              <p data-testid="industry" style={{ margin: 'var(--space-1) 0' }}>Industry: {r.industry ? (INDUSTRY[r.industry] ?? r.industry) : 'Not given'}{r.industryOther ? ` (${r.industryOther})` : ''}</p>
              <p style={{ margin: 'var(--space-1) 0' }}><a href={`mailto:${r.workEmail}`}>{r.workEmail}</a>{r.phone ? <> · <a href={`tel:${r.phone}`}>{r.phone}</a></> : null}</p>
              <p className="ui-secondary" style={{ margin: 'var(--space-1) 0' }}>
                {r.ownership ? (OWNERSHIP[r.ownership] ?? r.ownership) : `Ownership: ${NOT_ASKED}`}{r.tradeLicenceNumber ? ` · trade licence ${r.tradeLicenceNumber}` : ''} · conversations: {r.conversationOwnership ? (CONVERSATIONS[r.conversationOwnership] ?? r.conversationOwnership) : NOT_ASKED}
                {r.conversationOwnershipOther ? ` (${r.conversationOwnershipOther})` : ''} · volume: {r.expectedVolume ? (VOLUME[r.expectedVolume] ?? r.expectedVolume) : NOT_ASKED}
              </p>
              {r.employerPermissionAcceptedAt != null && (
                <p data-testid="employer-permission" style={{ margin: 'var(--space-2) 0' }}>Confirmed their employer's permission ({new Date(r.employerPermissionAcceptedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })})</p>
              )}
              {r.ownership === 'employed' && r.status === 'pending' && r.employerPermissionAcceptedAt == null && (
                <p style={{ margin: 'var(--space-2) 0', color: 'var(--amber)' }}>Employed: ask for the company NOC before approving.</p>
              )}
              {r.reviewedNote && <p className="ui-secondary" style={{ margin: 'var(--space-2) 0' }}>Note: {r.reviewedNote}</p>}
              <div className="ui-cluster ui-gap-2" style={{ marginTop: 'var(--space-3)' }}>
                {r.status === 'pending' && (
                  <>
                    <Button variant="primary" size="sm" disabled={busy === r.id} onClick={() => void act(r, 'approve')}>Approve</Button>
                    <Button size="sm" disabled={busy === r.id} onClick={() => void act(r, 'reject')}>Reject</Button>
                  </>
                )}
                {r.status === 'invited' && <Button size="sm" disabled={busy === r.id} onClick={() => void act(r, 'reinvite')}>Re-invite</Button>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
