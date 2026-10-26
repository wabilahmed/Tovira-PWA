import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AnswersGate, type AccessAnswersApi } from './AccessAnswers.js';
import { CONFIRMATION_TEXT } from './RequestAccess.js';

/**
 * [P46-6c.2] Owner: a rep approved from a hot lead answers the blank questions and ticks the confirmation on first
 * sign-in, before they reach Clients. A form sign-up who already answered never sees this step.
 */
const ALL = ['phone', 'ownership', 'conversationOwnership', 'expectedVolume', 'industry', 'confirmation'];
const api = (required: boolean, over: Partial<AccessAnswersApi> = {}): AccessAnswersApi => ({
  status: vi.fn().mockResolvedValue({ required, missing: required ? ALL : [] }),
  submit: vi.fn().mockResolvedValue({ ok: true }),
  ...over,
});

describe('[P46-6c.2] the first sign-in questions', () => {
  it('NEGATIVE: a rep who already answered goes straight to the app', async () => {
    render(<AnswersGate api={api(false)}><p>Clients</p></AnswersGate>);
    expect(await screen.findByText('Clients')).toBeInTheDocument();
    expect(screen.queryByText(CONFIRMATION_TEXT)).toBeNull();
  });

  it('a hot-lead invitee sees the blank questions and the exact confirmation, not the app', async () => {
    render(<AnswersGate api={api(true)}><p>Clients</p></AnswersGate>);
    expect(await screen.findByText(CONFIRMATION_TEXT)).toBeInTheDocument();
    expect(screen.queryByText('Clients')).toBeNull();
    for (const q of ['Phone', 'Which industry do you sell in?', 'Do you own or manage this company, or are you employed by it?', 'Whose client conversations do you intend to upload?', 'Roughly how many client conversations do you expect to upload?']) {
      expect(screen.getByText(q)).toBeInTheDocument();
    }
  });

  it('NEGATIVE: Continue stays disabled until the confirmation is ticked', async () => {
    const a = api(true);
    render(<AnswersGate api={a}><p>Clients</p></AnswersGate>);
    await screen.findByText(CONFIRMATION_TEXT);
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    expect(a.submit).not.toHaveBeenCalled();
  });

  it('answers + the confirmation → sent, then the app opens', async () => {
    const a = api(true);
    render(<AnswersGate api={a}><p>Clients</p></AnswersGate>);
    await screen.findByText(CONFIRMATION_TEXT);
    await userEvent.type(screen.getByLabelText('Phone'), '+971 50 386 3103');
    await userEvent.click(screen.getByLabelText('Insurance'));
    await userEvent.click(screen.getByLabelText('I am employed by it'));
    await userEvent.click(screen.getByLabelText('My own clients. I hold the relationship directly.'));
    await userEvent.click(screen.getByLabelText('Under 50'));
    await userEvent.click(screen.getByText(CONFIRMATION_TEXT));
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(a.submit).toHaveBeenCalledWith({ phone: '+971 50 386 3103', industry: 'insurance', industryOther: '', ownership: 'employed', tradeLicenceNumber: '', conversationOwnership: 'own_clients', conversationOwnershipOther: '', expectedVolume: 'under_50', confirmationAccepted: true }));
    expect(await screen.findByText('Clients')).toBeInTheDocument();
  });

  it("NEGATIVE: a refused answer shows the server's message and stays on the questions", async () => {
    const a = api(true, { submit: vi.fn().mockResolvedValue({ ok: false, message: 'Add the country code, for example +971 50 123 4567.' }) });
    render(<AnswersGate api={a}><p>Clients</p></AnswersGate>);
    await screen.findByText(CONFIRMATION_TEXT);
    await userEvent.type(screen.getByLabelText('Phone'), '050');
    await userEvent.click(screen.getByText(CONFIRMATION_TEXT));
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Add the country code');
    expect(screen.queryByText('Clients')).toBeNull();
  });
});
