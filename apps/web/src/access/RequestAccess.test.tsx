import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RequestAccess, CONFIRMATION_TEXT } from './RequestAccess.js';
import type { AccessRequestClient } from './requestAccessClient.js';

const makeClient = (): AccessRequestClient & { submit: ReturnType<typeof vi.fn> } => ({
  submit: vi.fn().mockResolvedValue({ id: 'req-1' }),
});

async function fillBase(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.type(screen.getByLabelText('Full name'), 'Dana Rep');
  await user.type(screen.getByLabelText('Work email'), 'dana@brokerage.ae');
  await user.type(screen.getByLabelText('Phone'), '+971 50 123 4567');
  await user.type(screen.getByLabelText('Company name'), 'Meridian');
  await user.type(screen.getByLabelText('Role / job title'), 'Broker');
}

describe('<RequestAccess>', () => {
  it('reveals the trade licence field only when "own or manage" is chosen', async () => {
    const user = userEvent.setup();
    render(<RequestAccess client={makeClient()} />);
    expect(screen.queryByLabelText('Trade licence number')).toBeNull();
    await user.click(screen.getByLabelText('I own or manage it'));
    expect(screen.getByLabelText('Trade licence number')).toBeTruthy();
  });

  it('shows the NOC-by-email note (no upload) when "employed" is chosen', async () => {
    const user = userEvent.setup();
    render(<RequestAccess client={makeClient()} />);
    await user.click(screen.getByLabelText('I am employed by it'));
    expect(screen.getByTestId('noc-note').textContent).toMatch(/NOC/);
    expect(screen.queryByLabelText('Trade licence number')).toBeNull();
    // Deliberately no file input anywhere on the form.
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it('reveals the free-text box only for the "Other" conversation option', async () => {
    const user = userEvent.setup();
    render(<RequestAccess client={makeClient()} />);
    expect(screen.queryByLabelText('Please describe')).toBeNull();
    // [P42 · owner] Industry has its own "Other" now; this is the conversations one.
    await user.click(screen.getByLabelText('Other', { selector: 'input[name="conversationOwnership"]' }));
    expect(screen.getByLabelText('Please describe')).toBeTruthy();
  });

  it('shows the exact confirmation sentence and keeps submit disabled until it is ticked', async () => {
    const user = userEvent.setup();
    render(<RequestAccess client={makeClient()} />);
    expect(screen.getByText(CONFIRMATION_TEXT)).toBeTruthy();
    const submit = screen.getByRole('button', { name: /request access/i });
    expect(submit).toBeDisabled();
    await user.click(screen.getByRole('checkbox'));
    expect(submit).not.toBeDisabled();
  });

  it('submits the collected payload and shows the confirmation screen', async () => {
    const user = userEvent.setup();
    const client = makeClient();
    render(<RequestAccess client={client} />);
    await fillBase(user);
    await user.click(screen.getByLabelText('I own or manage it'));
    await user.type(screen.getByLabelText('Trade licence number'), 'TL-123');
    // [P42 · owner] "brokerage" became "company" in the label; the stored value is unchanged.
    await user.click(screen.getByLabelText('Clients of the company I own or manage.'));
    await user.click(screen.getByLabelText('50–200'));
    // [P42 · owner] Industry is a required question.
    await user.click(screen.getByLabelText('Insurance'));
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: /request access/i }));

    await waitFor(() => expect(client.submit).toHaveBeenCalledTimes(1));
    expect(client.submit).toHaveBeenCalledWith(expect.objectContaining({
      fullName: 'Dana Rep', workEmail: 'dana@brokerage.ae', ownership: 'owns_or_manages',
      tradeLicenceNumber: 'TL-123', conversationOwnership: 'brokerage_i_manage',
      conversationOwnershipOther: null, expectedVolume: '50_200', industry: 'insurance', industryOther: null, confirmationAccepted: true,
      company_url: '',
    }));
    expect(await screen.findByText(/request has been recorded/i)).toBeTruthy();
    expect(screen.getByText(/within 2 business days/i)).toBeTruthy();
  });

  // [P42-A5] Owner: the form speaks to every relationship-sales rep, not brokerages or field sales.
  it('the intro is for sales people whose clients stay with them for years; the options say company', () => {
    render(<RequestAccess client={makeClient()} />);
    expect(screen.getByText('Tovira is in private beta for sales people whose clients stay with them for years. Tell us a little about you and we’ll be in touch.')).toBeTruthy();
    expect(screen.getByLabelText('Clients of the company I own or manage.')).toBeTruthy();
    expect(screen.getByLabelText('Clients of the company that employs me.')).toBeTruthy();
  });

  it('NEGATIVE: no "brokerage" and no "field sales" anywhere on the form', () => {
    const { container } = render(<RequestAccess client={makeClient()} />);
    expect(container.textContent).not.toMatch(/brokerage|field sales/i);
  });

  // [P42-A6] Owner: a required Industry question, seven choices in this order, Other with free text.
  it('asks "Which industry do you sell in?" with the seven choices in order', () => {
    render(<RequestAccess client={makeClient()} />);
    const group = screen.getByRole('group', { name: 'Which industry do you sell in?' });
    expect(within(group).getAllByRole('radio').map((r) => r.closest('label')?.textContent)).toEqual(['Insurance', 'Wealth / private banking', 'B2B / key accounts', 'Luxury / client advisory', 'Recruitment', 'Property', 'Other']);
  });

  it('"Other" reveals its own free-text box and sends it', async () => {
    const user = userEvent.setup();
    const client = makeClient();
    render(<RequestAccess client={client} />);
    expect(screen.queryByLabelText('Your industry')).toBeNull();
    await user.click(screen.getByLabelText('Other', { selector: 'input[name="industry"]' }));
    await user.type(screen.getByLabelText('Your industry'), 'Yacht brokerage');
    await fillBase(user);
    await user.click(screen.getByLabelText('I am employed by it'));
    await user.click(screen.getByLabelText('My own clients. I hold the relationship directly.'));
    await user.click(screen.getByLabelText('Under 50'));
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: /request access/i }));
    await waitFor(() => expect(client.submit).toHaveBeenCalledWith(expect.objectContaining({ industry: 'other', industryOther: 'Yacht brokerage' })));
  });

  it('NEGATIVE: without an industry nothing is sent and every-question error shows', async () => {
    const user = userEvent.setup();
    const client = makeClient();
    render(<RequestAccess client={client} />);
    await fillBase(user);
    await user.click(screen.getByLabelText('I am employed by it'));
    await user.click(screen.getByLabelText('My own clients. I hold the relationship directly.'));
    await user.click(screen.getByLabelText('Under 50'));
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: /request access/i }));
    expect(await screen.findByText('Please complete every question.')).toBeTruthy();
    expect(client.submit).not.toHaveBeenCalled();
  });

  it('carries a hidden honeypot field a human never sees', () => {
    render(<RequestAccess client={makeClient()} />);
    const trap = document.querySelector('input[name="company_url"]') as HTMLInputElement | null;
    expect(trap).not.toBeNull();
    expect(trap!.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  // [INV-05] A ?ref= code from the landing URL is shown read-only AND sent with the request.
  it('shows the referral code read-only and submits it', async () => {
    window.history.replaceState({}, '', '/request-access?ref=TESTREF123');
    try {
      const user = userEvent.setup();
      const client = makeClient();
      render(<RequestAccess client={client} />);
      expect(screen.getByTestId('referral-note').textContent).toMatch(/TESTREF123/);
      await fillBase(user);
      await user.click(screen.getByLabelText('I own or manage it'));
      await user.type(screen.getByLabelText('Trade licence number'), 'TL-1');
      await user.click(screen.getByLabelText('My own clients. I hold the relationship directly.'));
      await user.click(screen.getByLabelText('Under 50'));
      await user.click(screen.getByLabelText('Recruitment')); // [P42 · owner] Industry is required
      await user.click(screen.getByText(CONFIRMATION_TEXT));
      await user.click(screen.getByRole('button', { name: /request access/i }));
      await waitFor(() => expect(client.submit).toHaveBeenCalled());
      expect(client.submit.mock.calls[0]![0].referralCode).toBe('TESTREF123');
    } finally {
      window.history.replaceState({}, '', '/');
    }
  });
});
