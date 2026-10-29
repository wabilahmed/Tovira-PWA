import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RequestAccess } from './RequestAccess.js';
import type { AccessRequestClient } from './requestAccessClient.js';

// [P58-7 · owner] The invite email's link opens this form with ?invite=<token>. The form loads the lead's name, email,
// company and job title from the server with it; the lead completes the rest (phone, industry, the questions, the
// confirmation tick). The email is locked to the invited address. An expired or invalid token is the normal empty form.
// Submitting from the invite is approved at once: the lead is told to look for the set-password email.
afterEach(() => { window.history.replaceState({}, '', '/'); });
const PREFILL = { fullName: 'Sara Khan', workEmail: 'sara@emaar.example', companyName: 'Emaar', roleTitle: 'Head of Leasing' };
function client(prefill: typeof PREFILL | null, approved = true): AccessRequestClient & { prefill: ReturnType<typeof vi.fn>; submit: ReturnType<typeof vi.fn> } {
  return { prefill: vi.fn(async () => prefill), submit: vi.fn(async () => ({ id: 'r1', approved })) };
}
async function complete(): Promise<void> {
  await userEvent.type(screen.getByLabelText('Phone'), '+971 50 123 4567');
  await userEvent.click(screen.getByRole('radio', { name: 'Property' }));
  await userEvent.click(screen.getByRole('radio', { name: /I am employed/i }));
  await userEvent.click(screen.getByRole('radio', { name: /My own clients/ }));
  await userEvent.click(screen.getByRole('radio', { name: 'Under 50' }));
  await userEvent.click(screen.getByRole('checkbox', { name: /I confirm the information/ })); // [P59-2] the confirmation, by name (an employed invitee has a second box)
}

describe('[P58-7] the request form from an invite', () => {
  it('prefills name, email, company and job title from the token; the email is locked; the token leaves the address bar', async () => {
    window.history.replaceState({}, '', '/request-access?invite=tok123');
    const c = client(PREFILL);
    render(<RequestAccess client={c} />);
    await waitFor(() => expect(screen.getByLabelText('Full name')).toHaveValue('Sara Khan'));
    expect(c.prefill).toHaveBeenCalledWith('tok123');
    expect(screen.getByLabelText('Company name')).toHaveValue('Emaar');
    expect(screen.getByLabelText('Role / job title')).toHaveValue('Head of Leasing');
    const email = screen.getByLabelText('Work email');
    expect(email).toHaveValue('sara@emaar.example');
    expect(email).toHaveAttribute('readonly');
    expect(screen.getByText('This invite is for sara@emaar.example.')).toBeInTheDocument();
    expect(window.location.search).toBe('');
    expect(screen.getByLabelText('Phone')).toHaveValue(''); // the rest is the lead's to complete
  });
  it('submitting sends the token; approved at once, the lead is told to look for the set-password email', async () => {
    window.history.replaceState({}, '', '/request-access?invite=tok123');
    const c = client(PREFILL);
    render(<RequestAccess client={c} />);
    await waitFor(() => expect(screen.getByLabelText('Full name')).toHaveValue('Sara Khan'));
    await complete();
    await userEvent.click(screen.getByRole('checkbox', { name: /employer's permission/ })); // [P59-2 · owner] employed invitees also tick this
    await userEvent.click(screen.getByRole('button', { name: /request access/i }));
    expect(c.submit).toHaveBeenCalledWith(expect.objectContaining({ inviteToken: 'tok123', workEmail: 'sara@emaar.example', fullName: 'Sara Khan' }));
    expect(await screen.findByText('Thank you. Your access is approved: we have emailed sara@emaar.example a link to set your password.')).toBeInTheDocument();
  });
  it('NEGATIVE: an expired or invalid token is the normal empty form; nothing is locked and no token is sent', async () => {
    window.history.replaceState({}, '', '/request-access?invite=expired');
    const c = client(null, false);
    render(<RequestAccess client={c} />);
    await waitFor(() => expect(c.prefill).toHaveBeenCalledWith('expired'));
    expect(screen.getByLabelText('Full name')).toHaveValue('');
    expect(screen.getByLabelText('Work email')).not.toHaveAttribute('readonly');
    expect(screen.queryByText(/This invite is for/)).toBeNull();
    await userEvent.type(screen.getByLabelText('Full name'), 'Dana Rep');
    await userEvent.type(screen.getByLabelText('Work email'), 'dana@brokerage.example');
    await userEvent.type(screen.getByLabelText('Company name'), 'Meridian');
    await userEvent.type(screen.getByLabelText('Role / job title'), 'Broker');
    await complete();
    await userEvent.click(screen.getByRole('button', { name: /request access/i }));
    expect(c.submit.mock.calls[0]![0]).not.toHaveProperty('inviteToken');
    expect(await screen.findByText(/We review requests within 2 business days/)).toBeInTheDocument();
  });
  it('NEGATIVE: with no ?invite= the form never asks the server for a prefill', () => {
    const c = client(PREFILL);
    render(<RequestAccess client={c} />);
    expect(c.prefill).not.toHaveBeenCalled();
  });
});

// [P59-2 · owner] An invitee who says they are employed also ticks the employer's permission (stored with the request);
// they are still approved at once, so the NOC note does not apply to them. Owners and public requests never see it.
const PERMISSION = 'I have my employer\'s permission to use Tovira with their clients\' information.';
describe('[P59-2] the employer\'s permission on the invite form', () => {
  it('employed invitee: the box with the exact wording, required to submit, sent with the request; no NOC note', async () => {
    window.history.replaceState({}, '', '/request-access?invite=tok123');
    const c = client(PREFILL);
    render(<RequestAccess client={c} />);
    await waitFor(() => expect(screen.getByLabelText('Full name')).toHaveValue('Sara Khan'));
    await complete(); // ticks the confirmation, chooses "I am employed by it"
    expect(screen.queryByTestId('noc-note')).toBeNull();
    const box = screen.getByRole('checkbox', { name: PERMISSION });
    expect(screen.getByRole('button', { name: /request access/i })).toBeDisabled();
    await userEvent.click(box);
    expect(screen.getByRole('button', { name: /request access/i })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: /request access/i }));
    expect(c.submit).toHaveBeenCalledWith(expect.objectContaining({ ownership: 'employed', employerPermissionAccepted: true, inviteToken: 'tok123' }));
  });
  it('NEGATIVE: an invitee who owns the business is not asked', async () => {
    window.history.replaceState({}, '', '/request-access?invite=tok123');
    render(<RequestAccess client={client(PREFILL)} />);
    await waitFor(() => expect(screen.getByLabelText('Full name')).toHaveValue('Sara Khan'));
    await userEvent.click(screen.getByRole('radio', { name: /I own or manage it/i }));
    expect(screen.queryByRole('checkbox', { name: PERMISSION })).toBeNull();
  });
  it('NEGATIVE: the public form (no invite) never shows it; the NOC note is unchanged', async () => {
    render(<RequestAccess client={client(PREFILL)} />);
    await userEvent.click(screen.getByRole('radio', { name: /I am employed/i }));
    expect(screen.queryByRole('checkbox', { name: PERMISSION })).toBeNull();
    expect(screen.getByTestId('noc-note')).toBeInTheDocument();
  });
});
