import { useCallback, useEffect, useState } from 'react';
import { AdminSignedOutError, type AdminApi, type HotLead, type InvitePreview, type LeadStatus, type LeadsView } from './adminClient.js';
import { ActionRow, Badge, Banner, Button, EmptyState, PageHeader, Sheet, TextInput } from '../ui/index.js';

/**
 * [P45-4 · owner] Hot leads from Explee, newest first, with the New count, status and country filters, and a card per
 * lead: who they are, their reply as a quote, when, the campaign; Email / Copy email / LinkedIn / Phone; a status
 * picker and notes; CSV export. [P58 · owner] "Send invite email" replaces Invite to beta: a preview of the founder's
 * email with an editable personal line, then Send; the card shows Invited / Requested / Signed up with the date; Resend
 * opens 3 days after the send, once. "Add test lead" lets the owner try it on himself.
 */
export const DEFAULT_PERSONAL_LINE = 'Thanks for your reply about Tovira.';
const RESEND_AFTER_MS = 3 * 86_400_000;
export const day = (ms: number): string => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
/** Whether the invite email can go to this lead now (first send), as the server decides it. */
const canInvite = (l: HotLead): boolean => !l.erased && !!l.email && !!l.name && !l.accessRequestId && l.inviteSentAt == null && !['not_interested', 'signed_up', 'requested'].includes(l.status);
const STATUS: Array<{ value: LeadStatus; label: string }> = [
  { value: 'new', label: 'New' }, { value: 'contacted', label: 'Contacted' }, { value: 'invited', label: 'Invited' },
  { value: 'requested', label: 'Requested' }, { value: 'signed_up', label: 'Signed up' }, { value: 'not_interested', label: 'Not interested' },
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

export function LeadsPanel({ api, onSignedOut, now = () => Date.now() }: { api: Pick<AdminApi, 'leads' | 'updateLead' | 'previewInvite' | 'sendInvite' | 'addTestLead' | 'downloadCsv'>; onSignedOut: () => void; now?: () => number }): JSX.Element {
  const [status, setStatus] = useState<LeadStatus | ''>('');
  const [country, setCountry] = useState('');
  const [view, setView] = useState<LeadsView | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [compose, setCompose] = useState<{ lead: HotLead; resend: boolean } | null>(null);
  const [testOpen, setTestOpen] = useState(false);

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
  async function sent(l: HotLead): Promise<void> {
    replace(l);
    setCompose(null);
    setNotice(`Invite sent to ${l.email ?? 'the lead'}.`);
  }
  async function addTest(t: { name: string; email: string; companyName: string; jobTitle: string }): Promise<void> {
    try {
      const l = await api.addTestLead(t);
      setView((v) => (v ? { ...v, leads: [l, ...v.leads] } : v));
      setTestOpen(false);
      setNotice(`Test lead added: ${l.email ?? ''}.`);
    } catch (err) { fail(err, 'Could not add the test lead.'); }
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
        <Button size="sm" onClick={() => setTestOpen(true)}>Add test lead</Button>
        <Button size="sm" onClick={() => void api.downloadCsv(csvPath, `tovira-hot-leads-${new Date(now()).toISOString().slice(0, 10)}.csv`).catch((err) => fail(err, 'Could not export.'))}>Export CSV</Button>
      </div>
      {view === null ? <p className="ui-secondary">Loading…</p> : view.leads.length === 0 ? (
        <EmptyState title={status || country ? 'No leads match this filter.' : 'No hot leads yet.'} />
      ) : (
        <ul className="ui-stack ui-gap-3" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {view.leads.map((l) => <LeadCard key={l.id} lead={l} now={now()} onStatus={setLeadStatus} onNotes={saveNotes} onInvite={(lead, resend) => setCompose({ lead, resend })} />)}
        </ul>
      )}
      {compose && <InviteSheet key={compose.lead.id} lead={compose.lead} resend={compose.resend} api={api} onClose={() => setCompose(null)} onSent={(l) => void sent(l)} onSignedOut={onSignedOut} />}
      <TestLeadSheet open={testOpen} onClose={() => setTestOpen(false)} onAdd={(t) => void addTest(t)} />
    </>
  );
}

/** [P58] The preview: who it goes to and from, the subject, the editable personal line, the email as it will look. Nothing
 *  is sent until Send. */
function InviteSheet({ lead, resend, api, onClose, onSent, onSignedOut }: { lead: HotLead; resend: boolean; api: Pick<AdminApi, 'previewInvite' | 'sendInvite'>; onClose: () => void; onSent: (l: HotLead) => void; onSignedOut: () => void }): JSX.Element {
  const [line, setLine] = useState(DEFAULT_PERSONAL_LINE);
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      api.previewInvite(lead.id, line).then((p) => { if (live) setPreview(p); }).catch((err) => { if (err instanceof AdminSignedOutError) onSignedOut(); else if (live) setProblem(err instanceof Error ? err.message : 'Could not load the preview.'); });
    }, 300);
    return () => { live = false; clearTimeout(t); };
  }, [api, lead.id, line, onSignedOut]);
  async function send(): Promise<void> {
    setBusy(true);
    setProblem(null);
    try { onSent(await api.sendInvite(lead.id, line, resend)); } catch (err) { if (err instanceof AdminSignedOutError) onSignedOut(); else setProblem(err instanceof Error ? err.message : 'Could not send the invite.'); } finally { setBusy(false); }
  }
  return (
    <Sheet open onClose={onClose} title={resend ? 'Resend the invite' : 'Send invite email'}>
      <div className="ui-stack ui-gap-3" data-testid="invite-preview">
        <dl className="ui-stack ui-gap-1" style={{ margin: 0 }}>
          <div><dt className="ui-caption" style={{ display: 'inline' }}>To </dt><dd style={{ display: 'inline', margin: 0 }}>{lead.email}</dd></div>
          <div><dt className="ui-caption" style={{ display: 'inline' }}>From </dt><dd style={{ display: 'inline', margin: 0 }}>{preview?.from ?? 'Wabil Ahmed, Tovira'}</dd></div>
          <div><dt className="ui-caption" style={{ display: 'inline' }}>Subject </dt><dd style={{ display: 'inline', margin: 0 }}>{preview?.subject ?? 'Your Tovira beta invite'}</dd></div>
        </dl>
        <TextInput label="Personal line" value={line} maxLength={500} onChange={(e) => setLine(e.target.value)} />
        {preview?.refusal && <Banner tone="danger">{preview.refusal.message}</Banner>}
        {problem && <Banner tone="danger">{problem}</Banner>}
        {preview ? (
          <iframe title="Email preview" sandbox="" srcDoc={preview.html} style={{ width: '100%', height: 560, border: '1px solid var(--hairline)', borderRadius: 8 }} />
        ) : <p className="ui-secondary">Loading the preview…</p>}
        <ActionRow>
          <Button variant="primary" loading={busy} disabled={!preview || !!preview.refusal} onClick={() => void send()}>{resend ? 'Resend' : 'Send'}</Button>
          <Button variant="text" onClick={onClose}>Cancel</Button>
        </ActionRow>
      </div>
    </Sheet>
  );
}

/** [P58] The owner's own test lead: marked as a test, never counted or exported. */
function TestLeadSheet({ open, onClose, onAdd }: { open: boolean; onClose: () => void; onAdd: (t: { name: string; email: string; companyName: string; jobTitle: string }) => void }): JSX.Element {
  const [t, setT] = useState({ name: '', email: '', companyName: '', jobTitle: '' });
  const set = (k: keyof typeof t) => (e: React.ChangeEvent<HTMLInputElement>) => setT((x) => ({ ...x, [k]: e.target.value }));
  return (
    <Sheet open={open} onClose={onClose} title="Add test lead">
      <form className="ui-stack ui-gap-3" onSubmit={(e) => { e.preventDefault(); onAdd(t); }}>
        <p className="ui-secondary">A lead to try the invite email on yourself. It is marked Test, and never counted or exported.</p>
        <TextInput label="Name" value={t.name} onChange={set('name')} required />
        <TextInput label="Email" type="email" value={t.email} onChange={set('email')} required />
        <TextInput label="Company" value={t.companyName} onChange={set('companyName')} />
        <TextInput label="Job title" value={t.jobTitle} onChange={set('jobTitle')} />
        <ActionRow>
          <Button type="submit" variant="primary" disabled={!t.name.trim() || !t.email.trim()}>Add test lead</Button>
          <Button variant="text" onClick={onClose}>Cancel</Button>
        </ActionRow>
      </form>
    </Sheet>
  );
}

function LeadCard({ lead: l, now, onStatus, onNotes, onInvite }: { lead: HotLead; now: number; onStatus: (l: HotLead, s: LeadStatus) => void; onNotes: (l: HotLead, n: string) => void; onInvite: (l: HotLead, resend: boolean) => void }): JSX.Element {
  const [notes, setNotes] = useState(l.notes ?? '');
  const role = [l.jobTitle, l.companyName].filter(Boolean).join(' at ');
  return (
    <li data-testid={`lead-${l.id}`} className="ui-card" style={{ padding: 'var(--space-4)' }}>
      <div className="ui-cluster ui-cluster--between ui-gap-2">
        <strong>{l.erased ? 'Removed contact' : l.name ?? 'Unnamed'}</strong>
        <span className="ui-cluster ui-gap-1">
          {l.isTest && <Badge>Test</Badge>}
          {l.status === 'new' && <Badge tone="accent">New</Badge>}
        </span>
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
        {canInvite(l) && <Button variant="primary" size="sm" onClick={() => onInvite(l, false)}>Send invite email</Button>}
        {l.status === 'invited' && l.inviteSentAt != null && l.inviteResentAt == null && (now >= l.inviteSentAt + RESEND_AFTER_MS
          ? <Button size="sm" onClick={() => onInvite(l, true)}>Resend invite</Button>
          : <span className="ui-caption">Resend opens {day(l.inviteSentAt + RESEND_AFTER_MS)}</span>)}
        {l.accessRequestId && l.status !== 'requested' && l.status !== 'signed_up' && <span className="ui-caption">On the Access tab</span>}
      </div>
      <InviteTrail lead={l} />
      <label className="ui-field">
        <span className="ui-field__label">Notes</span>
        <textarea className="ui-input" aria-label="Notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <div><Button size="sm" onClick={() => onNotes(l, notes)} disabled={notes === (l.notes ?? '')}>Save notes</Button></div>
    </li>
  );
}

/** [P58] Where the invite stands: Invited (and re-sent) → Requested → Signed up, with the dates. */
function InviteTrail({ lead: l }: { lead: HotLead }): JSX.Element | null {
  const parts: string[] = [];
  if (l.inviteSentAt != null) parts.push(`Invited ${day(l.inviteSentAt)}`);
  if (l.inviteResentAt != null) parts.push(`re-sent ${day(l.inviteResentAt)}`);
  if (l.requestedAt != null) parts.push(`Requested ${day(l.requestedAt)}`);
  if (l.status === 'signed_up') parts.push('Signed up');
  return parts.length ? <p className="ui-caption" data-testid={`invite-trail-${l.id}`} style={{ margin: 0 }}>{parts.join(' · ')}</p> : null;
}
