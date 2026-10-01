import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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
    await user.click(screen.getByLabelText('Other'));
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
    await user.click(screen.getByLabelText('Clients of the brokerage I own or manage.'));
    await user.click(screen.getByLabelText('50–200'));
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: /request access/i }));

    await waitFor(() => expect(client.submit).toHaveBeenCalledTimes(1));
    expect(client.submit).toHaveBeenCalledWith(expect.objectContaining({
      fullName: 'Dana Rep', workEmail: 'dana@brokerage.ae', ownership: 'owns_or_manages',
      tradeLicenceNumber: 'TL-123', conversationOwnership: 'brokerage_i_manage',
      conversationOwnershipOther: null, expectedVolume: '50_200', confirmationAccepted: true,
      company_url: '',
    }));
    expect(await screen.findByText(/request has been recorded/i)).toBeTruthy();
    expect(screen.getByText(/within 2 business days/i)).toBeTruthy();
  });

  it('carries a hidden honeypot field a human never sees', () => {
    render(<RequestAccess client={makeClient()} />);
    const trap = document.querySelector('input[name="company_url"]') as HTMLInputElement | null;
    expect(trap).not.toBeNull();
    expect(trap!.closest('[aria-hidden="true"]')).not.toBeNull();
  });
});
