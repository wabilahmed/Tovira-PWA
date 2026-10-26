import { useCallback, useEffect, useState } from 'react';
import { AdminSignedOutError, type AdminApi, type HotLead, type LeadStatus, type LeadsView } from './adminClient.js';
import { Badge, Banner, Button, EmptyState, PageHeader } from '../ui/index.js';

/**
 * [P45-4 · owner] Hot leads from Explee, newest first, with the New count, status and country filters, and a card per
 * lead: who they are, their reply as a quote, when, the campaign; Email / Copy email / LinkedIn / Phone; a status
 * picker and notes; Invite to beta (a pending request on the Access tab, nothing sent until approved); CSV export.
 */
const STATUS: Array<{ value: LeadStatus; label: string }> = [
  { value: 'new', label: 'New' }, { value: 'contacted', label: 'Contacted' }, { value: 'invited', label: 'Invited' },
  { value: 'signed_up', label: 'Signed up' }, { value: 'not_interested', label: 'Not interested' },
];

export function ago(ms: number | null, now: number): string {
  if (!ms) return '';
  const m = Math.max(0, Math.round((now - ms) / 60_000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

export function LeadsPanel({ api, onSignedOut, now = () => Date.now() }: { api: Pick<AdminApi, 'leads' | 'updateLead' | 'inviteLead' | 'downloadCsv'>; onSignedOut: () => void; now?: () => number }): JSX.Element {
  const [status, setStatus] = useState<LeadStatus | ''>('');
  const [country, setCountry] = useState('');
  const [view, setView] = useState<LeadsView | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fail = useCallback((err: unknown, fallback: string) => {
    if (err instanceof AdminSignedOutError) onSignedOut(); else setError(err instanceof Error ? err.message : fallback);
  }, [onSignedOut]);
  const load = useCallback(async () => {
    try { setView(await api.leads({ ...(status ? { status } : {}), ...(country ? { country } : {}) })); } catch (err) { fail(err, 'Could not load leads.'); }
  }, [api, status, country, fail]);
  useEffect(() => { void load(); }, [load]);

  const replace = (l: HotLead) => setView((v) => (v ? { ...v, leads: v.leads.map((x) => (x.id === l.id ? l : x)) } : v));
  async function setLeadStatus(l: HotLead, s: LeadStatus): Promise<void> {
    try { replace(await api.updateLead(l.id, { status: s })); } catch (err) { fail(err, 'Could not save the status.'); }
  }
  async function saveNotes(l: HotLead, notes: string): Promise<void> {
    try { replace(await api.updateLead(l.id, { notes })); setNotice('Notes saved.'); } catch (err) { fail(err, 'Could not save the notes.'); }
  }
  async function invite(l: HotLead): Promise<void> {
    if (!window.confirm(`Add ${l.name ?? 'this lead'} (${l.email ?? ''}) to Access as a pending request? Nothing is sent until you approve it there.`)) return;
    try { replace(await api.inviteLead(l.id)); setNotice(`${l.name ?? 'The lead'} added to Access as a pending request. Approve it there to send the invite.`); } catch (err) { fail(err, 'Could not create the request.'); }
  }
  const csvPath = `/leads?${new URLSearchParams([...(status ? [['status', status]] : []), ...(country ? [['country', country]] : []), ['format', 'csv']]).toString()}`;

  return (
    <>
      <PageHeader title="Hot leads" subtitle="People who replied to outreach with real interest." />
      {view?.sync.banner && <Banner tone="danger">{view.sync.banner}</Banner>}
      {notice && <Banner tone="success">{notice}</Banner>}
      {error && <Banner tone="danger">{error}</Banner>}
      <div className="ui-cluster ui-gap-3" style={{ flexWrap: 'wrap', alignItems: 'end', marginBottom: 'var(--space-3)' }}>
        <span data-testid="new-count" className="ui-strong">{view ? `${view.newCount} new` : ''}</span>
        <label className="ui-field">
          <span className="ui-field__label">Filter by status</span>
          <select className="ui-input ui-native-select" aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value as LeadStatus | '')}>
            <option value="">All</option>
            {STATUS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </label>
        <label className="ui-field">
          <span className="ui-field__label">Filter by country</span>
          <select className="ui-input ui-native-select" aria-label="Filter by country" value={country} onChange={(e) => setCountry(e.target.value)}>
            <option value="">All</option>
            {(view?.countries ?? []).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <Button size="sm" onClick={() => void api.downloadCsv(csvPath, `tovira-hot-leads-${new Date(now()).toISOString().slice(0, 10)}.csv`).catch((err) => fail(err, 'Could not export.'))}>Export CSV</Button>
      </div>
      {view === null ? <p className="ui-secondary">Loading…</p> : view.leads.length === 0 ? (
        <EmptyState title={status || country ? 'No leads match this filter.' : 'No hot leads yet.'} />
      ) : (
        <ul className="ui-stack ui-gap-3" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {view.leads.map((l) => <LeadCard key={l.id} lead={l} now={now()} onStatus={setLeadStatus} onNotes={saveNotes} onInvite={invite} />)}
        </ul>
      )}
    </>
  );
}

function LeadCard({ lead: l, now, onStatus, onNotes, onInvite }: { lead: HotLead; now: number; onStatus: (l: HotLead, s: LeadStatus) => void; onNotes: (l: HotLead, n: string) => void; onInvite: (l: HotLead) => void }): JSX.Element {
  const [notes, setNotes] = useState(l.notes ?? '');
  const role = [l.jobTitle, l.companyName].filter(Boolean).join(' at ');
  return (
    <li data-testid={`lead-${l.id}`} className="ui-card" style={{ padding: 'var(--space-4)' }}>
      <div className="ui-cluster ui-cluster--between ui-gap-2">
        <strong>{l.erased ? 'Removed contact' : l.name ?? 'Unnamed'}</strong>
        {l.status === 'new' && <Badge tone="accent">New</Badge>}
      </div>
      {l.erased ? (
        <p className="ui-secondary">This person asked to be removed.</p>
      ) : (
        <>
          <p style={{ margin: 0 }}>{role}{l.country ? `${role ? ' · ' : ''}${l.country}` : ''}</p>
          {l.whyHot && <blockquote dir="auto" style={{ margin: 0, paddingLeft: 'var(--space-3)', borderLeft: '3px solid var(--color-accent, var(--brass))' }}>“{l.whyHot}”</blockquote>}
          <p className="ui-caption" style={{ margin: 0 }}>{ago(l.becameHotAt, now)}{l.campaignName ? ` · ${l.campaignName}` : ''}</p>
          <div className="ui-cluster ui-gap-2" style={{ flexWrap: 'wrap' }}>
            {l.email && <a className="ui-btn ui-btn--secondary ui-btn--sm" href={`mailto:${l.email}`}>Email</a>}
            {l.email && <Button size="sm" onClick={() => void navigator.clipboard?.writeText(l.email!)}>Copy email</Button>}
            {l.linkedinUrl && <a className="ui-btn ui-btn--secondary ui-btn--sm" href={l.linkedinUrl} target="_blank" rel="noopener noreferrer">LinkedIn</a>}
            {l.phone && <a className="ui-btn ui-btn--secondary ui-btn--sm" href={`tel:${l.phone}`}>Phone</a>}
          </div>
        </>
      )}
      <div className="ui-cluster ui-gap-3" style={{ flexWrap: 'wrap', alignItems: 'end' }}>
        <label className="ui-field">
          <span className="ui-field__label">Status</span>
          <select className="ui-input ui-native-select" aria-label="Status" value={l.status} onChange={(e) => onStatus(l, e.target.value as LeadStatus)}>
            {STATUS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </label>
        {!l.erased && !l.accessRequestId && l.email && <Button variant="primary" size="sm" onClick={() => onInvite(l)}>Invite to beta</Button>}
        {l.accessRequestId && <span className="ui-caption">On the Access tab</span>}
      </div>
      <label className="ui-field">
        <span className="ui-field__label">Notes</span>
        <textarea className="ui-input" aria-label="Notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <div><Button size="sm" onClick={() => onNotes(l, notes)} disabled={notes === (l.notes ?? '')}>Save notes</Button></div>
    </li>
  );
}
