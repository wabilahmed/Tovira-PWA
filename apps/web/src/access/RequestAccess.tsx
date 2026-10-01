import { useState, type FormEvent, type JSX } from 'react';
import { AccessRequestError, type AccessRequestClient, type AccessRequestPayload } from './requestAccessClient.js';

/** The confirmation sentence is a PRODUCT DECISION — do not reword, expand, or add a second clause.
 *  Its version lives in the API constants module (CONFIRMATION_TEXT_VERSION), stored with each request. */
export const CONFIRMATION_TEXT =
  'I confirm the information above is true and accurate to the best of my knowledge, and that I have the authority to share the client conversations I have described with Tovira.';

const CONVERSATION_OPTIONS: Array<{ value: AccessRequestPayload['conversationOwnership']; label: string }> = [
  { value: 'own_clients', label: 'My own clients. I hold the relationship directly.' },
  { value: 'brokerage_i_manage', label: 'Clients of the brokerage I own or manage.' },
  { value: 'brokerage_employs_me', label: 'Clients of the brokerage that employs me.' },
  { value: 'mix', label: 'A mix of the above.' },
  { value: 'other', label: 'Other' },
];
const VOLUME_OPTIONS: Array<{ value: AccessRequestPayload['expectedVolume']; label: string }> = [
  { value: 'under_50', label: 'Under 50' },
  { value: '50_200', label: '50–200' },
  { value: '200_500', label: '200–500' },
  { value: '500_plus', label: '500+' },
];

export function RequestAccess({ client }: { client: AccessRequestClient }): JSX.Element {
  const [submitted, setSubmitted] = useState<{ employed: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [fullName, setFullName] = useState('');
  const [workEmail, setWorkEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [roleTitle, setRoleTitle] = useState('');
  const [ownership, setOwnership] = useState<'' | 'owns_or_manages' | 'employed'>('');
  const [tradeLicenceNumber, setTradeLicenceNumber] = useState('');
  const [conversationOwnership, setConversationOwnership] = useState<'' | AccessRequestPayload['conversationOwnership']>('');
  const [conversationOwnershipOther, setConversationOwnershipOther] = useState('');
  const [expectedVolume, setExpectedVolume] = useState<'' | AccessRequestPayload['expectedVolume']>('');
  const [confirmed, setConfirmed] = useState(false);
  const [honeypot, setHoneypot] = useState(''); // company_url — stays empty for a human

  if (submitted) {
    return (
      <main className="auth-card" aria-live="polite">
        <h1>Request received</h1>
        <p>Thank you — your request has been recorded. We review requests within 2 business days.</p>
        {submitted.employed && (
          <p>Because you are employed by the company, we will email you to ask for the company’s NOC (no-objection certificate) before activating your access.</p>
        )}
      </main>
    );
  }

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    if (ownership === '' || conversationOwnership === '' || expectedVolume === '') {
      setError('Please complete every question.');
      return;
    }
    if (!confirmed) {
      setError('Please tick the confirmation box to submit.');
      return;
    }
    setBusy(true);
    try {
      await client.submit({
        fullName, workEmail, phone, companyName, roleTitle,
        ownership,
        tradeLicenceNumber: ownership === 'owns_or_manages' ? tradeLicenceNumber : null,
        conversationOwnership,
        conversationOwnershipOther: conversationOwnership === 'other' ? conversationOwnershipOther : null,
        expectedVolume,
        confirmationAccepted: confirmed,
        company_url: honeypot,
      });
      setSubmitted({ employed: ownership === 'employed' });
    } catch (err) {
      setError(err instanceof AccessRequestError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-card">
      <h1>Request beta access</h1>
      <p>Tovira is in private beta for field salespeople. Tell us a little about you and we’ll be in touch.</p>
      <form onSubmit={(e) => void onSubmit(e)} noValidate>
        {/* 1. Full name, work email, phone */}
        <label>Full name<input value={fullName} onChange={(e) => setFullName(e.target.value)} required /></label>
        <label>Work email<input type="email" value={workEmail} onChange={(e) => setWorkEmail(e.target.value)} required /></label>
        <label>Phone<input value={phone} onChange={(e) => setPhone(e.target.value)} required /></label>
        {/* 2. Company */}
        <label>Company name<input value={companyName} onChange={(e) => setCompanyName(e.target.value)} required /></label>
        {/* 3. Role */}
        <label>Role / job title<input value={roleTitle} onChange={(e) => setRoleTitle(e.target.value)} required /></label>

        {/* 4. Ownership */}
        <fieldset>
          <legend>Do you own or manage this company, or are you employed by it?</legend>
          <label><input type="radio" name="ownership" checked={ownership === 'owns_or_manages'} onChange={() => setOwnership('owns_or_manages')} /> I own or manage it</label>
          <label><input type="radio" name="ownership" checked={ownership === 'employed'} onChange={() => setOwnership('employed')} /> I am employed by it</label>
        </fieldset>
        {ownership === 'owns_or_manages' && (
          <label>Trade licence number<input value={tradeLicenceNumber} onChange={(e) => setTradeLicenceNumber(e.target.value)} required /></label>
        )}
        {ownership === 'employed' && (
          <p className="auth-hint" data-testid="noc-note">After you submit, we will email you to ask for the company’s NOC (no-objection certificate). There is nothing to upload here.</p>
        )}

        {/* 5. Whose conversations */}
        <fieldset>
          <legend>Whose client conversations do you intend to upload?</legend>
          {CONVERSATION_OPTIONS.map((o) => (
            <label key={o.value}>
              <input type="radio" name="conversationOwnership" checked={conversationOwnership === o.value} onChange={() => setConversationOwnership(o.value)} /> {o.label}
            </label>
          ))}
        </fieldset>
        {conversationOwnership === 'other' && (
          <label>Please describe<input value={conversationOwnershipOther} onChange={(e) => setConversationOwnershipOther(e.target.value)} required /></label>
        )}

        {/* 6. Volume */}
        <fieldset>
          <legend>Roughly how many client conversations do you expect to upload?</legend>
          {VOLUME_OPTIONS.map((o) => (
            <label key={o.value}>
              <input type="radio" name="expectedVolume" checked={expectedVolume === o.value} onChange={() => setExpectedVolume(o.value)} /> {o.label}
            </label>
          ))}
        </fieldset>

        {/* Honeypot — visually hidden, off the tab order, not autocompleted. A human never fills it. */}
        <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, overflow: 'hidden' }}>
          <label>Company URL<input tabIndex={-1} autoComplete="off" name="company_url" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} /></label>
        </div>

        {/* Mandatory confirmation — exact product wording, do not change */}
        <label className="auth-confirm">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          {CONFIRMATION_TEXT}
        </label>

        <p className="auth-hint">
          We use the details above only to review your request. See our <a href="/privacy">Privacy Policy</a> for how we handle your personal data.
        </p>

        {error && <p className="auth-error" role="alert">{error}</p>}
        <button type="submit" disabled={busy || !confirmed}>{busy ? 'Submitting…' : 'Request access'}</button>
      </form>
    </main>
  );
}
