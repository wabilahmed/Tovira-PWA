import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RequestAccess, CONFIRMATION_TEXT } from './RequestAccess.js';
import type { AccessRequestClient } from './requestAccessClient.js';

const makeClient = (): AccessRequestClient & { submit: ReturnType<typeof vi.fn> } => ({
  submit: vi.fn().mockResolvedValue({ id: 'req-1' }),
});

// [P90 · owner, Prompt 88, batch 1] The form is three steps now ("Split the one long form into three steps"): these
// tests keep every assertion they had and walk the steps to reach it. step 1 = about you, step 2 = your company,
// step 3 = your clients. Each helper leaves the form on the NEXT step.
const next = async (user: ReturnType<typeof userEvent.setup>): Promise<void> => { await user.click(screen.getByRole('button', { name: 'Next' })); };
/** Step 1 (about you), then Next: the form is on step 2. */
async function fillBase(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.type(screen.getByLabelText('Full name'), 'Dana Rep');
  await user.type(screen.getByLabelText('Work email'), 'dana@brokerage.ae');
  await user.type(screen.getByLabelText('Phone'), '+971 50 123 4567');
  // [P75 · owner] the form now requires a WhatsApp number with its country code (pin moved with the owner's new rule)
  await user.selectOptions(screen.getByLabelText('Country code'), 'AE');
  await user.type(screen.getByLabelText('WhatsApp number'), '050 123 4567');
  await next(user);
}
/** Step 2 (your company) with the given industry and ownership, then Next: the form is on step 3. */
async function fillCompany(user: ReturnType<typeof userEvent.setup>, industry: string, own: 'own' | 'employed', licence = 'TL-123'): Promise<void> {
  await user.type(screen.getByLabelText('Company name'), 'Meridian');
  await user.type(screen.getByLabelText('Role / job title'), 'Broker');
  await user.click(screen.getByLabelText(industry));
  if (own === 'own') { await user.click(screen.getByLabelText('I own or manage it')); await user.type(screen.getByLabelText('Trade licence number'), licence); }
  else await user.click(screen.getByLabelText('I am employed by it'));
  await next(user);
}

describe('<RequestAccess>', () => {
  it('reveals the trade licence field only when "own or manage" is chosen', async () => {
    const user = userEvent.setup();
    render(<RequestAccess client={makeClient()} />);
    await fillBase(user); // [P90] the question is on step 2
    expect(screen.queryByLabelText('Trade licence number')).toBeNull();
    await user.click(screen.getByLabelText('I own or manage it'));
    expect(screen.getByLabelText('Trade licence number')).toBeTruthy();
  });

  it('shows the NOC-by-email note (no upload) when "employed" is chosen', async () => {
    const user = userEvent.setup();
    render(<RequestAccess client={makeClient()} />);
    await fillBase(user); // [P90] the question is on step 2
    await user.click(screen.getByLabelText('I am employed by it'));
    expect(screen.getByTestId('noc-note').textContent).toMatch(/NOC/);
    expect(screen.queryByLabelText('Trade licence number')).toBeNull();
    // Deliberately no file input anywhere on the form.
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it('reveals the free-text box only for the "Other" conversation option', async () => {
    const user = userEvent.setup();
    render(<RequestAccess client={makeClient()} />);
    await fillBase(user); await fillCompany(user, 'Insurance', 'employed'); // [P90] the question is on step 3
    expect(screen.queryByLabelText('Please describe')).toBeNull();
    // [P42 · owner] Industry has its own "Other" now; this is the conversations one.
    await user.click(screen.getByLabelText('Other', { selector: 'input[name="conversationOwnership"]' }));
    expect(screen.getByLabelText('Please describe')).toBeTruthy();
  });

  // [P90 · owner, Prompt 88, batch 1] moved: the confirmation is on step 3, and Request access now also waits for the
  // step's two questions ("Next is disabled until that step is complete, the same way Request access is today").
  it('shows the exact confirmation sentence and keeps submit disabled until it is ticked', async () => {
    const user = userEvent.setup();
    render(<RequestAccess client={makeClient()} />);
    await fillBase(user); await fillCompany(user, 'Insurance', 'employed');
    expect(screen.getByText(CONFIRMATION_TEXT)).toBeTruthy();
    const submit = screen.getByRole('button', { name: /request access/i });
    await user.click(screen.getByLabelText('My own clients. I hold the relationship directly.'));
    await user.click(screen.getByLabelText('Under 50'));
    expect(submit).toBeDisabled();
    await user.click(screen.getByRole('checkbox'));
    expect(submit).not.toBeDisabled();
  });

  it('submits the collected payload and shows the confirmation screen', async () => {
    const user = userEvent.setup();
    const client = makeClient();
    render(<RequestAccess client={client} />);
    await fillBase(user);
    // [P42 · owner] Industry is a required question.
    await fillCompany(user, 'Insurance', 'own');
    // [P42 · owner] "brokerage" became "company" in the label; the stored value is unchanged.
    await user.click(screen.getByLabelText('Clients of the company I own or manage.'));
    await user.click(screen.getByLabelText('50–200'));
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: /request access/i }));

    await waitFor(() => expect(client.submit).toHaveBeenCalledTimes(1));
    expect(client.submit).toHaveBeenCalledWith(expect.objectContaining({
      fullName: 'Dana Rep', workEmail: 'dana@brokerage.ae', ownership: 'owns_or_manages',
      tradeLicenceNumber: 'TL-123', conversationOwnership: 'brokerage_i_manage',
      conversationOwnershipOther: null, expectedVolume: '50_200', industry: 'insurance', industryOther: null, confirmationAccepted: true,
      hp_trap_7: '', // [P63-2] the trap's new name
    }));
    // [P90 · owner, Prompt 88, batch 1] moved: the received screen is "Got it. You're in the queue." then "Thank you. We
    // review requests within 2 business days." (was "Thank you. Your request has been recorded. We review…")
    expect(await screen.findByRole('heading', { name: "Got it. You're in the queue." })).toBeTruthy();
    expect(screen.getByText('Thank you. We review requests within 2 business days.')).toBeTruthy();
  });

  // [P42-A5] Owner: the form speaks to every relationship-sales rep, not brokerages or field sales.
  // [P90 · owner, Prompt 88, batch 1] moved: the intro line is now "Tovira is in private beta. Tell us a little about you
  // and we'll be in touch." (the owner's new wording); the options still say company (step 3).
  it('the intro is the private-beta line; the options say company', async () => {
    const user = userEvent.setup();
    render(<RequestAccess client={makeClient()} />);
    expect(screen.getByText("Tovira is in private beta. Tell us a little about you and we'll be in touch.")).toBeTruthy();
    await fillBase(user); await fillCompany(user, 'Insurance', 'employed');
    expect(screen.getByLabelText('Clients of the company I own or manage.')).toBeTruthy();
    expect(screen.getByLabelText('Clients of the company that employs me.')).toBeTruthy();
  });

  it('NEGATIVE: no "brokerage" and no "field sales" anywhere on the form (every step)', async () => {
    const user = userEvent.setup();
    const { container } = render(<RequestAccess client={makeClient()} />);
    expect(container.textContent).not.toMatch(/brokerage|field sales/i);
    await user.type(screen.getByLabelText('Full name'), 'Dana Rep'); await user.type(screen.getByLabelText('Work email'), 'dana@example.com');
    await user.type(screen.getByLabelText('Phone'), '+971 50 123 4567'); await user.selectOptions(screen.getByLabelText('Country code'), 'AE');
    await user.type(screen.getByLabelText('WhatsApp number'), '050 123 4567'); await next(user);
    expect(container.textContent).not.toMatch(/brokerage|field sales/i);
    await fillCompany(user, 'Insurance', 'employed');
    expect(container.textContent).not.toMatch(/brokerage|field sales/i);
  });

  // [P42-A6] Owner: a required Industry question, seven choices in this order, Other with free text.
  it('asks "Which industry do you sell in?" with the seven choices in order', async () => {
    const user = userEvent.setup();
    render(<RequestAccess client={makeClient()} />);
    await fillBase(user); // [P90] the question is on step 2
    const group = screen.getByRole('group', { name: 'Which industry do you sell in?' });
    expect(within(group).getAllByRole('radio').map((r) => r.closest('label')?.textContent)).toEqual(['Insurance', 'Wealth / private banking', 'B2B / key accounts', 'Luxury / client advisory', 'Recruitment', 'Property', 'Other']);
  });

  it('"Other" reveals its own free-text box and sends it', async () => {
    const user = userEvent.setup();
    const client = makeClient();
    render(<RequestAccess client={client} />);
    await fillBase(user); // [P90] step 1 first; the industry is on step 2
    expect(screen.queryByLabelText('Your industry')).toBeNull();
    await user.type(screen.getByLabelText('Company name'), 'Meridian');
    await user.type(screen.getByLabelText('Role / job title'), 'Broker');
    await user.click(screen.getByLabelText('Other', { selector: 'input[name="industry"]' }));
    await user.type(screen.getByLabelText('Your industry'), 'Yacht brokerage');
    await user.click(screen.getByLabelText('I am employed by it'));
    await next(user);
    await user.click(screen.getByLabelText('My own clients. I hold the relationship directly.'));
    await user.click(screen.getByLabelText('Under 50'));
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: /request access/i }));
    await waitFor(() => expect(client.submit).toHaveBeenCalledWith(expect.objectContaining({ industry: 'other', industryOther: 'Yacht brokerage' })));
  });

  // [P90 · owner, Prompt 88, batch 1] moved: "Next is disabled until that step is complete". Without an industry the
  // rep cannot leave step 2, so nothing can be sent (the "Please complete every question." message is no longer reachable).
  it('NEGATIVE: without an industry the form cannot go past step 2 and nothing is sent', async () => {
    const user = userEvent.setup();
    const client = makeClient();
    render(<RequestAccess client={client} />);
    await fillBase(user);
    await user.type(screen.getByLabelText('Company name'), 'Meridian');
    await user.type(screen.getByLabelText('Role / job title'), 'Broker');
    await user.click(screen.getByLabelText('I am employed by it'));
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Step 2 of 3')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /request access/i })).toBeNull();
    expect(client.submit).not.toHaveBeenCalled();
  });

  // [P63-2 · owner] was "company_url" / "Company URL": autofill could fill it with the person's company. Now a name and
  // label autofill and password managers never match.
  it('carries a hidden honeypot field a human never sees, named so autofill never fills it', () => {
    render(<RequestAccess client={makeClient()} />);
    const trap = document.querySelector('input[name="hp_trap_7"]') as HTMLInputElement | null;
    expect(trap).not.toBeNull();
    expect(trap!.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(trap!.getAttribute('autocomplete')).toBe('off');
    expect(trap!.hasAttribute('data-lpignore')).toBe(true);
    expect(trap!.hasAttribute('data-1p-ignore')).toBe(true);
    expect(trap!.closest('label')!.textContent).not.toMatch(/company|url|website|email|name|phone/i);
    expect(document.querySelector('input[name="company_url"]')).toBeNull();
  });

  // [INV-05] A ?ref= code from the landing URL is shown read-only AND sent with the request.
  // [P46-3 · owner] shown only with REFERRALS_ENABLED on; this test runs with it on.
  it('shows the referral code read-only and submits it', async () => {
    window.history.replaceState({}, '', '/request-access?ref=TESTREF123');
    try {
      const user = userEvent.setup();
      const client = makeClient();
      render(<RequestAccess client={client} referralsEnabled />);
      expect(screen.getByTestId('referral-note').textContent).toMatch(/TESTREF123/);
      await fillBase(user);
      await fillCompany(user, 'Recruitment', 'own', 'TL-1'); // [P42 · owner] Industry is required
      await user.click(screen.getByLabelText('My own clients. I hold the relationship directly.'));
      await user.click(screen.getByLabelText('Under 50'));
      await user.click(screen.getByText(CONFIRMATION_TEXT));
      await user.click(screen.getByRole('button', { name: /request access/i }));
      await waitFor(() => expect(client.submit).toHaveBeenCalled());
      expect(client.submit.mock.calls[0]![0].referralCode).toBe('TESTREF123');
    } finally {
      window.history.replaceState({}, '', '/');
    }
  });

  // [P46-3] Owner: with referrals off (the default) the code is not shown, but it is still captured and sent.
  it('NEGATIVE: referrals off → no referral note on screen; the ?ref= code is still submitted', async () => {
    window.history.replaceState({}, '', '/request-access?ref=TESTREF123');
    try {
      const user = userEvent.setup();
      const client = makeClient();
      const { container } = render(<RequestAccess client={client} />);
      expect(screen.queryByTestId('referral-note')).toBeNull();
      expect(container.textContent).not.toMatch(/referral|TESTREF123/i);
      await fillBase(user);
      await fillCompany(user, 'Recruitment', 'own', 'TL-1');
      await user.click(screen.getByLabelText('My own clients. I hold the relationship directly.'));
      await user.click(screen.getByLabelText('Under 50'));
      await user.click(screen.getByText(CONFIRMATION_TEXT));
      await user.click(screen.getByRole('button', { name: /request access/i }));
      await waitFor(() => expect(client.submit).toHaveBeenCalled());
      expect(client.submit.mock.calls[0]![0].referralCode).toBe('TESTREF123');
    } finally {
      window.history.replaceState({}, '', '/');
    }
  });

  // [P71-T · owner] A request submitted in the same tab after the game's CTA counts once as a game sign-up (a
  // sessionStorage flag set by the CTA tap; no cookie). Without the flag, nothing is sent.
  it('a submit after a game CTA tap sends one game_signup beacon; without the flag, none', async () => {
    const beacons: string[] = [];
    const readBlob = (b: Blob) => new Promise<string>((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.readAsText(b); });
    // [P90 · owner, Prompt 88, batch 1] the form also sends its step-reached events (to /api/visit) now; this test counts
    // the game's beacon only (/api/game-event), as it always meant to
    Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: (u: string, b: Blob) => { if (u.includes('game-event')) void readBlob(b).then((t) => beacons.push(t)); return true; } });
    const submitOnce = async () => {
      const user = userEvent.setup();
      const client = makeClient();
      const { unmount } = render(<RequestAccess client={client} />);
      await fillBase(user);
      await fillCompany(user, 'Insurance', 'own');
      await user.click(screen.getByLabelText('Clients of the company I own or manage.'));
      await user.click(screen.getByLabelText('50–200'));
      await user.click(screen.getByRole('checkbox'));
      await user.click(screen.getByRole('button', { name: /request access/i }));
      await screen.findByText(/We review requests within 2 business days/i); // [P90] the received line (was "…has been recorded…")
      unmount();
    };
    sessionStorage.clear();
    await submitOnce();
    await new Promise((r) => setTimeout(r, 0));
    expect(beacons).toEqual([]);
    sessionStorage.setItem('tovira.gameCta', JSON.stringify({ industry: 'Luxury', bucket: '7-9' }));
    await submitOnce();
    await waitFor(() => expect(beacons).toHaveLength(1));
    expect(JSON.parse(beacons[0]!)).toEqual({ event: 'game_signup', industry: 'Luxury', bucket: '7-9' });
    expect(sessionStorage.getItem('tovira.gameCta')).toBeNull();
  });
});
