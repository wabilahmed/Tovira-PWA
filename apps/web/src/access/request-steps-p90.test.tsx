import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RequestAccess, CONFIRMATION_TEXT } from './RequestAccess.js';
import type { AccessRequestClient } from './requestAccessClient.js';

/**
 * [P90 · owner, Prompt 88, batch 1] 003 to 005 Request access: the one long form is three steps ("Step n of 3" and a
 * three-part bar): "Let's get you in." (about you), "Your company", "Your clients". Every field, option, rule and the
 * submitted payload are as before, including the hidden "Do not fill this in" field. Next is disabled until the step is
 * complete; Back keeps what was typed. Radio groups are tappable rows or pills that are still real radio inputs with
 * their labels and a fieldset legend. A funnel event is sent when each step is reached.
 */
const beacons: Array<Record<string, unknown>> = [];
beforeEach(() => {
  beacons.length = 0;
  const readBlob = (b: Blob) => new Promise<string>((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.readAsText(b); });
  Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: (u: string, b: Blob) => { void readBlob(b).then((t) => beacons.push({ url: u, ...JSON.parse(t) })); return true; } });
});
afterEach(() => { window.history.replaceState({}, '', '/'); });
const makeClient = (): AccessRequestClient & { submit: ReturnType<typeof vi.fn> } => ({ submit: vi.fn().mockResolvedValue({ id: 'req-1' }) });
const next = () => screen.getByRole('button', { name: 'Next' });
const heading = () => screen.getByRole('heading', { level: 1 });
const stepsSent = async () => { await new Promise((r) => setTimeout(r, 10)); return beacons.filter((b) => String(b.page).startsWith('request_step_')).map((b) => b.page); };

async function step1(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.type(screen.getByLabelText('Full name'), 'Dana Rep');
  await user.type(screen.getByLabelText('Work email'), 'dana@brokerage.ae');
  await user.type(screen.getByLabelText('Phone'), '+971 50 123 4567');
  await user.selectOptions(screen.getByLabelText('Country code'), 'AE');
  await user.type(screen.getByLabelText('WhatsApp number'), '050 123 4567');
}
async function step2(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.type(screen.getByLabelText('Company name'), 'Meridian');
  await user.type(screen.getByLabelText('Role / job title'), 'Broker');
  await user.click(screen.getByLabelText('Property'));
  await user.click(screen.getByLabelText('I own or manage it'));
  await user.type(screen.getByLabelText('Trade licence number'), 'TL-123');
}

describe('[P90] the request form in three steps', () => {
  it('step 1 "Let\'s get you in.": the label, the bar, the intro, the four fields and the helper line; Next waits for them', async () => {
    const user = userEvent.setup();
    render(<RequestAccess client={makeClient()} />);
    expect(screen.getByText('Step 1 of 3')).toBeInTheDocument();
    expect(heading()).toHaveTextContent("Let's get you in.");
    expect(screen.getByText("Tovira is in private beta. Tell us a little about you and we'll be in touch.")).toBeInTheDocument();
    expect(document.querySelectorAll('.auth__bar i')).toHaveLength(3);
    expect(document.querySelectorAll('.auth__bar i.on')).toHaveLength(1);
    expect(screen.getByTestId('whatsapp-hint')).toHaveTextContent('Once you’re approved, you’ll verify this number with one WhatsApp message.');
    expect(screen.queryByLabelText('Company name')).toBeNull(); // not on this step
    expect(next()).toBeDisabled();
    await step1(user);
    expect(next()).toBeEnabled();
  });

  it('step 2 "Your company": company, role, industry, own or employed; the trade licence field appears for "I own or manage it"', async () => {
    const user = userEvent.setup();
    render(<RequestAccess client={makeClient()} />);
    await step1(user); await user.click(next());
    expect(screen.getByText('Step 2 of 3')).toBeInTheDocument();
    expect(heading()).toHaveTextContent('Your company');
    expect(document.querySelectorAll('.auth__bar i.on')).toHaveLength(2);
    expect(next()).toBeDisabled();
    await user.type(screen.getByLabelText('Company name'), 'Meridian');
    await user.type(screen.getByLabelText('Role / job title'), 'Broker');
    await user.click(screen.getByLabelText('Property'));
    expect(screen.queryByLabelText('Trade licence number')).toBeNull();
    await user.click(screen.getByLabelText('I am employed by it'));
    expect(screen.queryByLabelText('Trade licence number')).toBeNull();
    expect(next()).toBeEnabled();
    await user.click(screen.getByLabelText('I own or manage it'));
    expect(screen.getByLabelText('Trade licence number')).toBeInTheDocument();
    expect(next()).toBeDisabled(); // the licence number is part of the step
    await user.type(screen.getByLabelText('Trade licence number'), 'TL-123');
    expect(next()).toBeEnabled();
  });

  it('step 3 "Your clients": whose conversations, how many, the confirmation and the privacy sentence, word for word', async () => {
    const user = userEvent.setup();
    render(<RequestAccess client={makeClient()} />);
    await step1(user); await user.click(next()); await step2(user); await user.click(next());
    expect(screen.getByText('Step 3 of 3')).toBeInTheDocument();
    expect(heading()).toHaveTextContent('Your clients');
    expect(document.querySelectorAll('.auth__bar i.on')).toHaveLength(3);
    expect(CONFIRMATION_TEXT).toBe('I confirm the information above is true and accurate to the best of my knowledge, and that I have the authority to share the client conversations I have described with Tovira.');
    expect(screen.getByRole('checkbox').closest('label')!.textContent).toBe(CONFIRMATION_TEXT);
    expect(screen.getByTestId('privacy-sentence').textContent).toBe("We use the details above to review your request and, if it's approved, to verify your WhatsApp number. See our Privacy Policy for how we handle your personal data.");
    expect(within(screen.getByTestId('privacy-sentence')).getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/privacy');
    const submit = screen.getByRole('button', { name: 'Request access' });
    expect(submit).toBeDisabled();
    await user.click(screen.getByLabelText('My own clients. I hold the relationship directly.'));
    await user.click(screen.getByLabelText('Under 50'));
    expect(submit).toBeDisabled(); // still the confirmation
    await user.click(screen.getByRole('checkbox'));
    expect(submit).toBeEnabled();
  });

  it('submits exactly the payload the one-page form sent', async () => {
    const user = userEvent.setup();
    const client = makeClient();
    render(<RequestAccess client={client} />);
    await step1(user); await user.click(next()); await step2(user); await user.click(next());
    await user.click(screen.getByLabelText('Clients of the company I own or manage.'));
    await user.click(screen.getByLabelText('50–200'));
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Request access' }));
    await waitFor(() => expect(client.submit).toHaveBeenCalledTimes(1));
    expect(client.submit.mock.calls[0]![0]).toEqual({
      fullName: 'Dana Rep', workEmail: 'dana@brokerage.ae', phone: '+971 50 123 4567', companyName: 'Meridian', roleTitle: 'Broker',
      whatsappNumber: '+971501234567', ownership: 'owns_or_manages', tradeLicenceNumber: 'TL-123',
      conversationOwnership: 'brokerage_i_manage', conversationOwnershipOther: null, expectedVolume: '50_200',
      industry: 'property', industryOther: null, confirmationAccepted: true, referralCode: null, hp_trap_7: '',
    });
  });

  it('Back keeps what was typed and chosen, on every step', async () => {
    const user = userEvent.setup();
    render(<RequestAccess client={makeClient()} />);
    await step1(user); await user.click(next()); await step2(user); await user.click(next());
    await user.click(screen.getByLabelText('A mix of the above.'));
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(heading()).toHaveTextContent('Your company');
    expect(screen.getByLabelText('Company name')).toHaveValue('Meridian');
    expect(screen.getByLabelText('Property')).toBeChecked();
    expect(screen.getByLabelText('I own or manage it')).toBeChecked();
    expect(screen.getByLabelText('Trade licence number')).toHaveValue('TL-123');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(heading()).toHaveTextContent("Let's get you in.");
    expect(screen.getByLabelText('Full name')).toHaveValue('Dana Rep');
    expect(screen.getByLabelText('Work email')).toHaveValue('dana@brokerage.ae');
    expect(screen.getByLabelText('Phone')).toHaveValue('+971 50 123 4567');
    expect(screen.getByLabelText('Country code')).toHaveValue('AE');
    expect(screen.getByLabelText('WhatsApp number')).toHaveValue('050 123 4567');
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull(); // nothing before step 1
    await user.click(next()); await user.click(next());
    expect(screen.getByLabelText('A mix of the above.')).toBeChecked();
  });

  it('the radio groups are real radio inputs with their labels in a fieldset with its legend; one choice per group', async () => {
    const user = userEvent.setup();
    render(<RequestAccess client={makeClient()} />);
    await step1(user); await user.click(next());
    const industry = screen.getByRole('group', { name: 'Which industry do you sell in?' });
    expect(industry.tagName).toBe('FIELDSET');
    const radios = within(industry).getAllByRole('radio') as HTMLInputElement[];
    expect(radios).toHaveLength(7);
    for (const r of radios) { expect(r.type).toBe('radio'); expect(r.name).toBe('industry'); expect(r.closest('label')).not.toBeNull(); }
    await user.click(screen.getByLabelText('Insurance')); await user.click(screen.getByLabelText('Recruitment'));
    expect(radios.filter((r) => r.checked).map((r) => r.closest('label')!.textContent)).toEqual(['Recruitment']);
    expect(screen.getByRole('group', { name: 'Do you own or manage this company, or are you employed by it?' })).toBeInTheDocument();
    await step2(user); await user.click(next());
    expect(within(screen.getByRole('group', { name: 'Whose client conversations do you intend to upload?' })).getAllByRole('radio')).toHaveLength(5);
    expect(within(screen.getByRole('group', { name: 'Roughly how many client conversations do you expect to upload?' })).getAllByRole('radio')).toHaveLength(4);
  });

  it('the hidden "Do not fill this in" field is on every step, off the tab order, and sent', async () => {
    const user = userEvent.setup();
    const client = makeClient();
    render(<RequestAccess client={client} />);
    const trap = () => document.querySelector('input[name="hp_trap_7"]') as HTMLInputElement;
    expect(trap().closest('label')!.textContent).toBe('Do not fill this in');
    expect(trap().tabIndex).toBe(-1);
    await step1(user); await user.click(next()); expect(trap()).not.toBeNull();
    await step2(user); await user.click(next()); expect(trap()).not.toBeNull();
    expect(trap().closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it('NEGATIVE: a WhatsApp number that is not valid stops at step 1 with the same message as before, announced', async () => {
    const user = userEvent.setup();
    render(<RequestAccess client={makeClient()} />);
    await user.type(screen.getByLabelText('Full name'), 'Dana Rep');
    await user.type(screen.getByLabelText('Work email'), 'dana@brokerage.ae');
    await user.type(screen.getByLabelText('Phone'), '+971 50 123 4567');
    await user.type(screen.getByLabelText('WhatsApp number'), '07911 123456'); // no country code chosen
    await user.click(next());
    expect(screen.getByRole('alert')).toHaveTextContent('Please choose your country code and enter your WhatsApp number.');
    expect(heading()).toHaveTextContent("Let's get you in.");
    await user.selectOptions(screen.getByLabelText('Country code'), 'AE');
    await user.clear(screen.getByLabelText('WhatsApp number'));
    await user.type(screen.getByLabelText('WhatsApp number'), '050 12');
    await user.click(next());
    expect(screen.getByRole('alert')).toHaveTextContent('That doesn’t look like a WhatsApp number. Check the country code and the number.');
    expect(heading()).toHaveTextContent("Let's get you in.");
  });

  it('received: "Got it. You\'re in the queue." (the second sentence marked) and the thank-you line', async () => {
    const user = userEvent.setup();
    const { container } = render(<RequestAccess client={makeClient()} />);
    await step1(user); await user.click(next()); await step2(user); await user.click(next());
    await user.click(screen.getByLabelText('My own clients. I hold the relationship directly.'));
    await user.click(screen.getByLabelText('Under 50'));
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Request access' }));
    await waitFor(() => expect(heading()).toHaveTextContent("Got it. You're in the queue."));
    expect([...container.querySelectorAll('.auth__mk')].map((m) => m.textContent)).toEqual(["You're in the queue."]);
    expect(screen.getByText('Thank you. We review requests within 2 business days.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Request access' })).toBeNull();
  });

  it('a funnel event when each step is reached: once each, in order, never again on Back', async () => {
    const user = userEvent.setup();
    render(<RequestAccess client={makeClient()} />);
    expect(await stepsSent()).toEqual(['request_step_1']);
    await step1(user); await user.click(next());
    expect(await stepsSent()).toEqual(['request_step_1', 'request_step_2']);
    await step2(user); await user.click(next());
    expect(await stepsSent()).toEqual(['request_step_1', 'request_step_2', 'request_step_3']);
    await user.click(screen.getByRole('button', { name: 'Back' })); await user.click(next());
    expect(await stepsSent()).toEqual(['request_step_1', 'request_step_2', 'request_step_3']);
    for (const b of beacons) { expect(b.url).toBe('/api/visit'); expect(JSON.stringify(b)).not.toMatch(/Dana|brokerage|971/); } // nothing typed is sent
  });

  it('at most one mark per step, never on a button or input', async () => {
    const user = userEvent.setup();
    const { container } = render(<RequestAccess client={makeClient()} />);
    const ok = () => { expect(container.querySelectorAll('.auth__mk').length).toBeLessThanOrEqual(1); expect(container.querySelector('button .auth__mk, input.auth__mk, button.auth__mk')).toBeNull(); };
    ok(); await step1(user); await user.click(next()); ok(); await step2(user); await user.click(next()); ok();
  });
});
