import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { AuthShell } from '../auth/AuthShell.js';
import { CONFIRMATION_TEXT, CONVERSATION_OPTIONS, INDUSTRY_OPTIONS, VOLUME_OPTIONS } from './RequestAccess.js';

export type MissingAnswer = 'phone' | 'ownership' | 'conversationOwnership' | 'expectedVolume' | 'industry' | 'confirmation';
export interface AccessAnswersPayload {
  phone: string; industry: string; industryOther: string; ownership: string; tradeLicenceNumber: string;
  conversationOwnership: string; conversationOwnershipOther: string; expectedVolume: string; confirmationAccepted: true;
}
export interface AccessAnswersApi {
  status(): Promise<{ required: boolean; missing: MissingAnswer[] } | null>;
  submit(p: AccessAnswersPayload): Promise<{ ok: true } | { ok: false; message: string }>;
}

/** Talks to /me/access-answers. A failed status read lets the app open (the server still refuses captures). */
export class AccessAnswersClient implements AccessAnswersApi {
  constructor(private readonly baseUrl = '') {}
  async status(): Promise<{ required: boolean; missing: MissingAnswer[] } | null> {
    try {
      const res = await fetch(`${this.baseUrl}/me/access-answers`, { credentials: 'include' });
      return res.ok ? ((await res.json()) as { required: boolean; missing: MissingAnswer[] }) : null;
    } catch { return null; }
  }
  async submit(p: AccessAnswersPayload): Promise<{ ok: true } | { ok: false; message: string }> {
    try {
      const res = await fetch(`${this.baseUrl}/me/access-answers`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify(p) });
      if (res.ok) return { ok: true };
      return { ok: false, message: ((await res.json().catch(() => ({}))) as { message?: string }).message ?? 'Could not save your answers. Try again.' };
    } catch { return { ok: false, message: 'Could not save your answers. Try again.' }; }
  }
}

/**
 * [P46-6c.2] Before the app: a rep approved from a hot lead answers the questions the request form would have asked
 * (only the blank ones) and ticks the same confirmation, word for word. Everyone else goes straight in.
 */
export function AnswersGate({ api, children }: { api: AccessAnswersApi; children: ReactNode }): JSX.Element {
  const [state, setState] = useState<{ required: boolean; missing: MissingAnswer[] } | null | 'loading'>('loading');
  useEffect(() => { void api.status().then((s) => setState(s ?? { required: false, missing: [] })); }, [api]);
  if (state === 'loading') return <p className="ui-secondary" style={{ padding: 'var(--space-4)' }}>Loading…</p>;
  if (!state || !state.required) return <>{children}</>;
  return <AccessAnswersForm api={api} missing={state.missing} onDone={() => setState({ required: false, missing: [] })} />;
}

function AccessAnswersForm({ api, missing, onDone }: { api: AccessAnswersApi; missing: MissingAnswer[]; onDone: () => void }): JSX.Element {
  const asks = (m: MissingAnswer): boolean => missing.includes(m);
  const [phone, setPhone] = useState('');
  const [industry, setIndustry] = useState('');
  const [industryOther, setIndustryOther] = useState('');
  const [ownership, setOwnership] = useState('');
  const [tradeLicenceNumber, setTradeLicenceNumber] = useState('');
  const [conversationOwnership, setConversationOwnership] = useState('');
  const [conversationOwnershipOther, setConversationOwnershipOther] = useState('');
  const [expectedVolume, setExpectedVolume] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!confirmed) return;
    setBusy(true);
    setError(null);
    const r = await api.submit({ phone, industry, industryOther, ownership, tradeLicenceNumber, conversationOwnership, conversationOwnershipOther, expectedVolume, confirmationAccepted: true });
    setBusy(false);
    if (r.ok) onDone(); else setError(r.message);
  }

  return (
    <AuthShell subtitle="A few questions first">
      <p className="auth__intro">Before you start, tell us a little about your work, and confirm the conversations you share are yours to share.</p>
      <form className="auth__form" onSubmit={(e) => void submit(e)} noValidate>
        {asks('phone') && <label className="auth__field"><span>Phone</span><input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+971 50 123 4567" required /></label>}
        {asks('industry') && (
          <fieldset className="auth__fieldset">
            <legend>Which industry do you sell in?</legend>
            {INDUSTRY_OPTIONS.map((o) => <label key={o.value} className="auth__option"><input type="radio" name="industry" checked={industry === o.value} onChange={() => setIndustry(o.value)} /><span>{o.label}</span></label>)}
          </fieldset>
        )}
        {asks('industry') && industry === 'other' && <label className="auth__field"><span>Your industry</span><input value={industryOther} onChange={(e) => setIndustryOther(e.target.value)} required /></label>}
        {asks('ownership') && (
          <fieldset className="auth__fieldset">
            <legend>Do you own or manage this company, or are you employed by it?</legend>
            <label className="auth__option"><input type="radio" name="ownership" checked={ownership === 'owns_or_manages'} onChange={() => setOwnership('owns_or_manages')} /><span>I own or manage it</span></label>
            <label className="auth__option"><input type="radio" name="ownership" checked={ownership === 'employed'} onChange={() => setOwnership('employed')} /><span>I am employed by it</span></label>
          </fieldset>
        )}
        {asks('ownership') && ownership === 'owns_or_manages' && <label className="auth__field"><span>Trade licence number</span><input value={tradeLicenceNumber} onChange={(e) => setTradeLicenceNumber(e.target.value)} required /></label>}
        {asks('conversationOwnership') && (
          <fieldset className="auth__fieldset">
            <legend>Whose client conversations do you intend to upload?</legend>
            {CONVERSATION_OPTIONS.map((o) => <label key={o.value} className="auth__option"><input type="radio" name="conversationOwnership" checked={conversationOwnership === o.value} onChange={() => setConversationOwnership(o.value)} /><span>{o.label}</span></label>)}
          </fieldset>
        )}
        {asks('conversationOwnership') && conversationOwnership === 'other' && <label className="auth__field"><span>Please describe</span><input value={conversationOwnershipOther} onChange={(e) => setConversationOwnershipOther(e.target.value)} required /></label>}
        {asks('expectedVolume') && (
          <fieldset className="auth__fieldset">
            <legend>Roughly how many client conversations do you expect to upload?</legend>
            {VOLUME_OPTIONS.map((o) => <label key={o.value} className="auth__option"><input type="radio" name="expectedVolume" checked={expectedVolume === o.value} onChange={() => setExpectedVolume(o.value)} /><span>{o.label}</span></label>)}
          </fieldset>
        )}
        {/* Mandatory confirmation: the exact product wording of the request form */}
        <label className="auth__consent">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          <span>{CONFIRMATION_TEXT}</span>
        </label>
        {error && <p className="auth__error" role="alert">{error}</p>}
        <button className="auth__submit" type="submit" disabled={busy || !confirmed}>{busy ? 'Saving…' : 'Continue'}</button>
      </form>
    </AuthShell>
  );
}
