import { useState, type FormEvent, type JSX, type ReactNode, useEffect, useRef } from 'react';
import { gameSignedUp } from '../marketing/game-track.js';
import { AccessRequestError, type AccessRequestClient, type AccessRequestPayload } from './requestAccessClient.js';
import { AuthAlert, AuthShell, Mark, Steps, TickIcon } from '../auth/AuthShell.js';
import { sendVisit } from '../marketing/visit.js';
import { countryCodeOptions, toE164 } from './whatsappNumber.js';

/** [P75] Built once: every country by name with its code. */
const COUNTRY_CODES = countryCodeOptions();

/** The confirmation sentence is a PRODUCT DECISION — do not reword, expand, or add a second clause.
 *  Its version lives in the API constants module (CONFIRMATION_TEXT_VERSION), stored with each request. */
export const CONFIRMATION_TEXT =
  'I confirm the information above is true and accurate to the best of my knowledge, and that I have the authority to share the client conversations I have described with Tovira.';

export const CONVERSATION_OPTIONS: Array<{ value: AccessRequestPayload['conversationOwnership']; label: string }> = [
  { value: 'own_clients', label: 'My own clients. I hold the relationship directly.' },
  { value: 'brokerage_i_manage', label: 'Clients of the company I own or manage.' },
  { value: 'brokerage_employs_me', label: 'Clients of the company that employs me.' },
  { value: 'mix', label: 'A mix of the above.' },
  { value: 'other', label: 'Other' },
];
/** [P42-A6] Owner: seven choices, in this order. The stored values are the API's. */
export const INDUSTRY_OPTIONS: Array<{ value: AccessRequestPayload['industry']; label: string }> = [
  { value: 'insurance', label: 'Insurance' },
  { value: 'wealth_private_banking', label: 'Wealth / private banking' },
  { value: 'b2b_key_accounts', label: 'B2B / key accounts' },
  { value: 'luxury_client_advisory', label: 'Luxury / client advisory' },
  { value: 'recruitment', label: 'Recruitment' },
  { value: 'property', label: 'Property' },
  { value: 'other', label: 'Other' },
];
export const VOLUME_OPTIONS: Array<{ value: AccessRequestPayload['expectedVolume']; label: string }> = [
  { value: 'under_50', label: 'Under 50' },
  { value: '50_200', label: '50–200' },
  { value: '200_500', label: '200–500' },
  { value: '500_plus', label: '500+' },
];

/** [P59-2 · owner] What an employed invitee must also tick, word for word (the server stores it with the request). */
export const EMPLOYER_PERMISSION_TEXT = 'I have my employer\'s permission to use Tovira with their clients\' information.';

/** [P90] A radio group as tappable rows (or pills): real radio inputs with their labels, in a fieldset with its legend. */
function RadioGroup<T extends string>({ legend, name, options, value, onChange, look = 'rows' }: { legend: string; name: string; options: Array<{ value: T; label: string }>; value: '' | T; onChange: (v: T) => void; look?: 'rows' | 'pills' | 'grid' }): JSX.Element {
  return (
    <fieldset className="auth__fieldset">
      <legend>{legend}</legend>
      <div className={`auth__options${look === 'pills' ? ' auth__options--pills' : look === 'grid' ? ' auth__options--grid' : ''}`}>
        {options.map((o) => (
          <label key={o.value} className={`auth__option${look === 'rows' ? '' : ' auth__option--pill'}`}>
            <input type="radio" name={name} checked={value === o.value} onChange={() => onChange(o.value)} /><span>{o.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
const OWNERSHIP_OPTIONS: Array<{ value: 'owns_or_manages' | 'employed'; label: string }> = [
  { value: 'owns_or_manages', label: 'I own or manage it' },
  { value: 'employed', label: 'I am employed by it' },
];

/**
 * The beta access-request form.
 * [P90 · owner, Prompt 88, batch 1] Three steps with "Step n of 3" and a three-part bar: "Let's get you in." (about you),
 * "Your company", "Your clients". Every field, option, validation rule and the submitted payload are as before,
 * including the hidden "Do not fill this in" field (on every step). Next is disabled until its step is complete; Back
 * keeps what was typed (the answers live here, above the steps); a refresh starts again. Each step reached sends one
 * cookieless funnel event (request_step_1..3) for Admin, Funnel.
 */
export function RequestAccess({ client, referralsEnabled = false }: { client: AccessRequestClient; /** [P46-3] off: the ?ref= code is captured and sent, never shown */ referralsEnabled?: boolean }): JSX.Element {
  const [submitted, setSubmitted] = useState<{ employed: boolean; approved: boolean } | null>(null);
  // [P58-7] The founder's invite link (?invite=<token>): the server prefills four fields; the email is then locked. The
  // token is read once and taken out of the address bar. An expired or invalid one is the normal empty form.
  const [inviteToken] = useState<string | null>(() => {
    try {
      if (typeof window === 'undefined') return null;
      const params = new URLSearchParams(window.location.search);
      const t = params.get('invite');
      if (t) { params.delete('invite'); const q = params.toString(); window.history.replaceState(window.history.state, '', `${window.location.pathname}${q ? `?${q}` : ''}`); }
      return t;
    } catch {
      return null;
    }
  });
  const [invitedEmail, setInvitedEmail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  // each step counts once per page load, when first reached (never again on Back)
  const reached = useRef(new Set<number>());
  useEffect(() => {
    if (reached.current.has(step)) return;
    reached.current.add(step);
    sendVisit(`request_step_${step}`);
  }, [step]);

  const [fullName, setFullName] = useState('');
  const [workEmail, setWorkEmail] = useState('');
  const [phone, setPhone] = useState('');
  // [P75 · owner] Required: the WhatsApp number, with a country-code picker. No country is chosen for the rep.
  const [waCountry, setWaCountry] = useState('');
  const [waNumber, setWaNumber] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [roleTitle, setRoleTitle] = useState('');
  const [industry, setIndustry] = useState<'' | AccessRequestPayload['industry']>('');
  const [industryOther, setIndustryOther] = useState('');
  const [ownership, setOwnership] = useState<'' | 'owns_or_manages' | 'employed'>('');
  const [tradeLicenceNumber, setTradeLicenceNumber] = useState('');
  const [conversationOwnership, setConversationOwnership] = useState<'' | AccessRequestPayload['conversationOwnership']>('');
  const [conversationOwnershipOther, setConversationOwnershipOther] = useState('');
  const [expectedVolume, setExpectedVolume] = useState<'' | AccessRequestPayload['expectedVolume']>('');
  const [confirmed, setConfirmed] = useState(false);
  const [employerPermission, setEmployerPermission] = useState(false); // [P59-2]
  const [honeypot, setHoneypot] = useState(''); // [P63-2] hp_trap_7 — stays empty for a human (autofill never matches it)
  // [BETA-3b] Capture the referral code from the landing URL (?ref=) so it survives the approval delay.
  const [referralCode] = useState<string | null>(() => {
    try {
      return typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('ref') : null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    if (!inviteToken || !client.prefill) return;
    let live = true;
    void client.prefill(inviteToken).then((p) => {
      if (!live || !p) return;
      setFullName(p.fullName); setWorkEmail(p.workEmail); setCompanyName(p.companyName); setRoleTitle(p.roleTitle);
      setInvitedEmail(p.workEmail);
    });
    return () => { live = false; };
  }, [inviteToken, client]);

  // [P59-2] an employed invitee (approved at once, no NOC wait) confirms the employer's permission instead
  const askPermission = invitedEmail !== null && ownership === 'employed';

  if (submitted?.approved) {
    return (
      <AuthShell heading="Request received." centered icon={<TickIcon />}>
        <div aria-live="polite" style={{ display: 'grid', gap: 'var(--space-3)' }}>
          <p className="auth__intro">Thank you. Your access is approved: we have emailed {workEmail} a link to set your password.</p>
        </div>
      </AuthShell>
    );
  }
  if (submitted) {
    return (
      <AuthShell heading={<>Got it. <Mark>You&apos;re in the queue.</Mark></>} centered icon={<TickIcon />}>
        <div aria-live="polite" style={{ display: 'grid', gap: 'var(--space-3)' }}>
          <p className="auth__intro">Thank you. We review requests within 2 business days.</p>
          {submitted.employed && (
            <p className="auth__hint">Because you are employed by the company, we will email you to ask for the company’s NOC (no-objection certificate) before activating your access.</p>
          )}
        </div>
      </AuthShell>
    );
  }

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    if (ownership === '' || industry === '' || conversationOwnership === '' || expectedVolume === '') {
      setError('Please complete every question.');
      return;
    }
    const wa = toE164(waCountry, waNumber);
    if (!wa.ok) {
      setError(wa.message);
      return;
    }
    if (!confirmed) {
      setError('Please tick the confirmation box to submit.');
      return;
    }
    if (askPermission && !employerPermission) {
      setError('Please tick that you have your employer\'s permission.');
      return;
    }
    setBusy(true);
    try {
      const r = await client.submit({
        ...(invitedEmail && inviteToken ? { inviteToken } : {}),
        ...(askPermission ? { employerPermissionAccepted: employerPermission } : {}),
        fullName, workEmail, phone, companyName, roleTitle,
        whatsappNumber: wa.e164,
        ownership,
        tradeLicenceNumber: ownership === 'owns_or_manages' ? tradeLicenceNumber : null,
        conversationOwnership,
        conversationOwnershipOther: conversationOwnership === 'other' ? conversationOwnershipOther : null,
        expectedVolume,
        industry,
        industryOther: industry === 'other' ? industryOther : null,
        confirmationAccepted: confirmed,
        referralCode,
        hp_trap_7: honeypot,
      });
      setSubmitted({ employed: ownership === 'employed', approved: r.approved === true });
      gameSignedUp(); // [P71-T] counts once as a game sign-up if the game's CTA was tapped in this tab
    } catch (err) {
      setError(err instanceof AccessRequestError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  // [P90] A step is complete when everything the server requires of it is there (the same rules it applies on submit).
  const filled = (v: string): boolean => v.trim() !== '';
  const step1Done = filled(fullName) && filled(workEmail) && filled(phone) && filled(waNumber);
  const step2Done = filled(companyName) && filled(roleTitle) && industry !== '' && (industry !== 'other' || filled(industryOther))
    && ownership !== '' && (ownership !== 'owns_or_manages' || filled(tradeLicenceNumber));
  const step3Done = conversationOwnership !== '' && (conversationOwnership !== 'other' || filled(conversationOwnershipOther))
    && expectedVolume !== '' && confirmed && (!askPermission || employerPermission);

  /** Next: step 1 checks the WhatsApp number the way submit always has, and says what to fix. */
  function goNext(e: FormEvent): void {
    e.preventDefault();
    setError(null);
    if (step === 1) {
      if (!step1Done) return;
      const wa = toE164(waCountry, waNumber);
      if (!wa.ok) { setError(wa.message); return; }
      setStep(2);
    } else if (step === 2 && step2Done) setStep(3);
  }
  const back = (): void => { setError(null); setStep((n) => (n === 3 ? 2 : 1)); };

  /* Honeypot — visually hidden, off the tab order, not autocompleted. A human never fills it. On every step. */
  const trap: ReactNode = (
    <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, overflow: 'hidden' }}>
      <label>Do not fill this in<input tabIndex={-1} autoComplete="off" data-lpignore="true" data-1p-ignore="true" name="hp_trap_7" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} /></label>
    </div>
  );

  if (step === 1) {
    return (
      <AuthShell step={<Steps step={1} />} heading="Let's get you in." lead="Tovira is in private beta. Tell us a little about you and we'll be in touch.">
        {/* [INV-05] A referral code from the landing URL (?ref=) rides along with the request. Show it
            read-only so the rep can see it was captured; an invalid code is ignored server-side, never a block. */}
        {referralsEnabled && referralCode && (
          <p className="auth__hint" data-testid="referral-note">Referral code: <strong>{referralCode}</strong></p>
        )}
        <form className="auth__form" onSubmit={goNext} noValidate>
          <label className="auth__field"><span>Full name</span><input value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" required /></label>
          <label className="auth__field"><span>Work email</span><input type="email" value={workEmail} onChange={(e) => setWorkEmail(e.target.value)} readOnly={invitedEmail !== null} aria-describedby={invitedEmail ? 'invite-email-note' : undefined} autoComplete="email" required /></label>
          {invitedEmail && <p className="auth__hint" id="invite-email-note">This invite is for {invitedEmail}.</p>}
          <label className="auth__field"><span>Phone</span><input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" required /></label>
          {/* [P75 · owner] WhatsApp number: the country code, then the number. Verified on WhatsApp once approved. */}
          <div className="auth__field">
            <span id="wa-number-label">WhatsApp number</span>
            <div className="auth__phone">
              <select className="ui-native-select" aria-label="Country code" value={waCountry} onChange={(e) => setWaCountry(e.target.value)} required>
                <option value="">Country code</option>
                {COUNTRY_CODES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
              <input aria-labelledby="wa-number-label" aria-describedby="wa-number-hint" type="tel" inputMode="tel" autoComplete="tel-national" placeholder="Your number" value={waNumber} onChange={(e) => setWaNumber(e.target.value)} required />
            </div>
            <p className="auth__hint" id="wa-number-hint" data-testid="whatsapp-hint">Once you’re approved, you’ll verify this number with one WhatsApp message.</p>
          </div>
          {trap}
          {error && <AuthAlert>{error}</AuthAlert>}
          <button className="auth__submit" type="submit" disabled={!step1Done}>Next</button>
        </form>
      </AuthShell>
    );
  }

  if (step === 2) {
    return (
      <AuthShell step={<Steps step={2} />} heading="Your company">
        <form className="auth__form" onSubmit={goNext} noValidate>
          <label className="auth__field"><span>Company name</span><input value={companyName} onChange={(e) => setCompanyName(e.target.value)} autoComplete="organization" required /></label>
          <label className="auth__field"><span>Role / job title</span><input value={roleTitle} onChange={(e) => setRoleTitle(e.target.value)} autoComplete="organization-title" required /></label>
          {/* [P42-A6] Industry */}
          <RadioGroup legend="Which industry do you sell in?" name="industry" options={INDUSTRY_OPTIONS} value={industry} onChange={setIndustry} look="pills" />
          {industry === 'other' && (
            <label className="auth__field"><span>Your industry</span><input value={industryOther} onChange={(e) => setIndustryOther(e.target.value)} required /></label>
          )}
          <RadioGroup legend="Do you own or manage this company, or are you employed by it?" name="ownership" options={OWNERSHIP_OPTIONS} value={ownership} onChange={setOwnership} />
          {ownership === 'owns_or_manages' && (
            <label className="auth__field"><span>Trade licence number</span><input value={tradeLicenceNumber} onChange={(e) => setTradeLicenceNumber(e.target.value)} required /></label>
          )}
          {ownership === 'employed' && !invitedEmail && (
            <p className="auth__hint" data-testid="noc-note">After you submit, we will email you to ask for the company’s NOC (no-objection certificate). There is nothing to upload here.</p>
          )}
          {trap}
          <div className="auth__row">
            <button className="auth__back" type="button" onClick={back}>Back</button>
            <button className="auth__submit" type="submit" disabled={!step2Done}>Next</button>
          </div>
        </form>
      </AuthShell>
    );
  }

  return (
    <AuthShell step={<Steps step={3} />} heading="Your clients">
      <form className="auth__form" onSubmit={(e) => void onSubmit(e)} noValidate>
        <RadioGroup legend="Whose client conversations do you intend to upload?" name="conversationOwnership" options={CONVERSATION_OPTIONS} value={conversationOwnership} onChange={setConversationOwnership} />
        {conversationOwnership === 'other' && (
          <label className="auth__field"><span>Please describe</span><input value={conversationOwnershipOther} onChange={(e) => setConversationOwnershipOther(e.target.value)} required /></label>
        )}
        <RadioGroup legend="Roughly how many client conversations do you expect to upload?" name="expectedVolume" options={VOLUME_OPTIONS} value={expectedVolume} onChange={setExpectedVolume} look="grid" />
        {trap}
        {/* Mandatory confirmation — exact product wording, do not change */}
        <label className="auth__consent auth__consent--small">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          <span>{CONFIRMATION_TEXT}</span>
        </label>
        {/* [P59-2 · owner] An employed invitee also confirms the employer's permission (stored with the request) */}
        {askPermission && (
          <label className="auth__consent auth__consent--small" data-testid="employer-permission">
            <input type="checkbox" checked={employerPermission} onChange={(e) => setEmployerPermission(e.target.checked)} />
            <span>{EMPLOYER_PERMISSION_TEXT}</span>
          </label>
        )}
        <p className="auth__hint" data-testid="privacy-sentence">
          {/* [P75 · owner] lawyer-approved, word for word */}We use the details above to review your request and, if it's approved, to verify your WhatsApp number. See our <a href="/privacy">Privacy Policy</a> for how we handle your personal data.
        </p>
        {error && <AuthAlert>{error}</AuthAlert>}
        <div className="auth__row">
          <button className="auth__back" type="button" onClick={back}>Back</button>
          <button className="auth__submit" type="submit" disabled={busy || !step3Done}>{busy ? 'Submitting…' : 'Request access'}</button>
        </div>
      </form>
    </AuthShell>
  );
}
