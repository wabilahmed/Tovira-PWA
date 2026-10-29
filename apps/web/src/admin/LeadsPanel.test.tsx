import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LeadsPanel } from './LeadsPanel.js';
import type { AdminApi, HotLead, LeadsView } from './adminClient.js';

/**
 * [P45-4 · owner] Leads: newest first with the New count, filters (status, country), and a card per lead: name, job
 * title and company with country, their reply as a quote, "2 hours ago", Email / Copy email / LinkedIn / Phone, a
 * status picker, notes, Invite to beta, and a CSV export. Explee's banner (credit out, key rejected) on top.
 */
const NOW = Date.parse('2026-10-26T12:00:00Z');
const lead = (o: Partial<HotLead> = {}): HotLead => ({ id: '1', personId: 'p1', campaignId: 7, campaignName: 'Dubai brokers', name: 'Layla Nasser', email: 'layla@acme.ae', jobTitle: 'Head of Sales', companyName: 'Acme', companyDomain: 'acme.ae', linkedinUrl: 'https://linkedin.com/in/layla', country: 'AE', phone: '+971501234567', whyHot: 'Yes, send me details', becameHotAt: NOW - 2 * 3_600_000, erased: false, status: 'new', notes: null, accessRequestId: null, firstSeenAt: NOW, updatedAt: NOW, ...o });
type LeadsApi = Pick<AdminApi, 'leads' | 'updateLead' | 'previewInvite' | 'sendInvite' | 'addTestLead' | 'downloadCsv'>;
function api(leads: HotLead[], banner: string | null = null, over: Partial<LeadsApi> = {}): LeadsApi {
  const view = (): LeadsView => ({ leads, newCount: leads.filter((l) => l.status === 'new').length, countries: ['AE', 'GB'], sync: { cursor: null, lastRunAt: NOW, lastStatus: 'ok', banner } });
  return {
    leads: vi.fn(async () => view()),
    updateLead: vi.fn(async (id, patch) => ({ ...leads.find((l) => l.id === id)!, ...patch })),
    // [P58 · owner] Invite to beta became the invite email
    previewInvite: vi.fn(async (_id: string, line: string) => ({ to: 'layla@acme.ae', from: '"Wabil Ahmed, Tovira" <wabil@tovira.io>', replyTo: 'wabil@tovira.io', subject: 'Your Tovira beta invite', html: `<p>Hi Layla,</p><p>${line}</p>`, text: `Hi Layla,\n\n${line}`, refusal: null })),
    sendInvite: vi.fn(async (id: string, _line: string, resend: boolean) => ({ ...leads.find((l) => l.id === id)!, status: 'invited' as const, ...(resend ? { inviteResentAt: NOW } : { inviteSentAt: NOW, inviteExpiresAt: NOW + 14 * 86_400_000 }) })),
    addTestLead: vi.fn(async (t: { name: string; email: string }) => lead({ id: '9', name: t.name, email: t.email, isTest: true, whyHot: null })),
    downloadCsv: vi.fn(async () => {}),
    ...over,
  };
}

describe('[P45-4] the Leads screen', () => {
  it('a card per lead: who, their reply as a quote, when, and the campaign', async () => {
    render(<LeadsPanel api={api([lead()])} onSignedOut={vi.fn()} now={() => NOW} />);
    const card = await screen.findByTestId('lead-1');
    for (const t of ['Layla Nasser', 'Head of Sales at Acme', 'AE', '“Yes, send me details”', '2 hours ago', 'Dubai brokers']) expect(card).toHaveTextContent(t);
    expect(screen.getByTestId('new-count')).toHaveTextContent('1 new');
  });

  it('Email, Copy email, LinkedIn, Phone', async () => {
    const writeText = vi.fn(async () => {});
    Object.assign(navigator, { clipboard: { writeText } });
    render(<LeadsPanel api={api([lead()])} onSignedOut={vi.fn()} now={() => NOW} />);
    const card = await screen.findByTestId('lead-1');
    expect(within(card).getByRole('link', { name: 'Email' })).toHaveAttribute('href', 'mailto:layla@acme.ae');
    expect(within(card).getByRole('link', { name: 'LinkedIn' })).toHaveAttribute('href', 'https://linkedin.com/in/layla');
    expect(within(card).getByRole('link', { name: 'Phone' })).toHaveAttribute('href', 'tel:+971501234567');
    await userEvent.click(within(card).getByRole('button', { name: 'Copy email' }));
    expect(writeText).toHaveBeenCalledWith('layla@acme.ae');
  });

  it('no phone → no Phone button; no LinkedIn → no LinkedIn button', async () => {
    render(<LeadsPanel api={api([lead({ phone: null, linkedinUrl: null })])} onSignedOut={vi.fn()} now={() => NOW} />);
    const card = await screen.findByTestId('lead-1');
    expect(within(card).queryByRole('link', { name: 'Phone' })).toBeNull();
    expect(within(card).queryByRole('link', { name: 'LinkedIn' })).toBeNull();
  });

  it('the status picker and notes save', async () => {
    const a = api([lead()]);
    render(<LeadsPanel api={a} onSignedOut={vi.fn()} now={() => NOW} />);
    const card = await screen.findByTestId('lead-1');
    await userEvent.selectOptions(within(card).getByLabelText('Status'), 'contacted');
    expect(a.updateLead).toHaveBeenCalledWith('1', { status: 'contacted' });
    await userEvent.type(within(card).getByLabelText('Notes'), 'Called');
    await userEvent.click(within(card).getByRole('button', { name: 'Save notes' }));
    expect(a.updateLead).toHaveBeenCalledWith('1', { notes: 'Called' });
  });

  it('filters by status and country, and exports the current filter as CSV', async () => {
    const a = api([lead()]);
    render(<LeadsPanel api={a} onSignedOut={vi.fn()} now={() => NOW} />);
    await screen.findByTestId('lead-1');
    await userEvent.selectOptions(screen.getByLabelText('Filter by status'), 'new');
    await userEvent.selectOptions(screen.getByLabelText('Filter by country'), 'AE');
    await waitFor(() => expect(a.leads).toHaveBeenLastCalledWith({ status: 'new', country: 'AE' }));
    await userEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    expect(a.downloadCsv).toHaveBeenCalledWith('/leads?status=new&country=AE&format=csv', expect.stringMatching(/^tovira-hot-leads-.*\.csv$/));
  });

  it('Explee\'s banner shows on top (credit out / key rejected)', async () => {
    render(<LeadsPanel api={api([], 'Explee credit is out')} onSignedOut={vi.fn()} now={() => NOW} />);
    expect(await screen.findByText('Explee credit is out')).toBeInTheDocument();
  });

  it('NEGATIVE: an erased lead shows no personal details and no contact buttons', async () => {
    render(<LeadsPanel api={api([lead({ erased: true, name: null, email: null, phone: null, linkedinUrl: null, whyHot: null, jobTitle: null, companyName: null })])} onSignedOut={vi.fn()} now={() => NOW} />);
    const card = await screen.findByTestId('lead-1');
    expect(card).toHaveTextContent('This person asked to be removed.');
    expect(within(card).queryByRole('link')).toBeNull();
  });
});

// [P58 · owner] "Send invite email" replaces Invite to beta (which made a pending request with blank answers).
describe('[P58] Send invite email', () => {
  it('opens a preview (To, From, Subject, the personal line, the email); nothing is sent until Send', async () => {
    const a = api([lead()]);
    render(<LeadsPanel api={a} onSignedOut={vi.fn()} now={() => NOW} />);
    await userEvent.click(within(await screen.findByTestId('lead-1')).getByRole('button', { name: 'Send invite email' }));
    const sheet = await screen.findByTestId('invite-preview');
    expect(within(sheet).getByLabelText('Personal line')).toHaveValue('Thanks for your reply about Tovira.');
    await waitFor(() => expect(a.previewInvite).toHaveBeenCalledWith('1', 'Thanks for your reply about Tovira.'));
    expect(await within(sheet).findByTitle('Email preview')).toBeInTheDocument();
    for (const t of ['layla@acme.ae', 'Wabil Ahmed, Tovira', 'Your Tovira beta invite']) expect(sheet).toHaveTextContent(t);
    expect(a.sendInvite).not.toHaveBeenCalled();
  });
  it('the edited personal line is previewed and sent; the card shows Invited with the date', async () => {
    const a = api([lead()]);
    render(<LeadsPanel api={a} onSignedOut={vi.fn()} now={() => NOW} />);
    await userEvent.click(within(await screen.findByTestId('lead-1')).getByRole('button', { name: 'Send invite email' }));
    const input = within(await screen.findByTestId('invite-preview')).getByLabelText('Personal line');
    await userEvent.clear(input);
    await userEvent.type(input, 'Great to meet you at GITEX.');
    await waitFor(() => expect(a.previewInvite).toHaveBeenLastCalledWith('1', 'Great to meet you at GITEX.'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(a.sendInvite).toHaveBeenCalledWith('1', 'Great to meet you at GITEX.', false);
    expect(await screen.findByText('Invite sent to layla@acme.ae.')).toBeInTheDocument();
    expect(screen.getByTestId('invite-trail-1')).toHaveTextContent('Invited 26 Oct 2026');
    expect(within(screen.getByTestId('lead-1')).queryByRole('button', { name: 'Send invite email' })).toBeNull();
  });
  it('Resend: not before 3 days (it says when it opens); after 3 days it sends a resend', async () => {
    const early = api([lead({ status: 'invited', inviteSentAt: NOW - 86_400_000 })]);
    const { unmount } = render(<LeadsPanel api={early} onSignedOut={vi.fn()} now={() => NOW} />);
    const card = await screen.findByTestId('lead-1');
    expect(within(card).queryByRole('button', { name: 'Resend invite' })).toBeNull();
    expect(card).toHaveTextContent('Resend opens 28 Oct 2026');
    unmount();
    const late = api([lead({ status: 'invited', inviteSentAt: NOW - 4 * 86_400_000 })]);
    render(<LeadsPanel api={late} onSignedOut={vi.fn()} now={() => NOW} />);
    await userEvent.click(within(await screen.findByTestId('lead-1')).getByRole('button', { name: 'Resend invite' }));
    await screen.findByTitle('Email preview'); // Send waits for the preview
    await userEvent.click(screen.getByRole('button', { name: 'Resend' }));
    expect(late.sendInvite).toHaveBeenCalledWith('1', 'Thanks for your reply about Tovira.', true);
  });
  it('NEGATIVE: no Send for a lead marked Not interested, already Requested or Signed up, or already re-sent', async () => {
    render(<LeadsPanel api={api([lead({ id: '1', status: 'not_interested' }), lead({ id: '2', status: 'requested', inviteSentAt: NOW - 86_400_000, requestedAt: NOW }), lead({ id: '3', status: 'signed_up' }), lead({ id: '4', status: 'invited', inviteSentAt: NOW - 9 * 86_400_000, inviteResentAt: NOW - 86_400_000 })])} onSignedOut={vi.fn()} now={() => NOW} />);
    for (const id of ['1', '2', '3', '4']) {
      const card = await screen.findByTestId(`lead-${id}`);
      expect(within(card).queryByRole('button', { name: /Send invite email|Resend invite/ })).toBeNull();
    }
    expect(screen.getByTestId('invite-trail-2')).toHaveTextContent('Invited 25 Oct 2026 · Requested 26 Oct 2026');
  });
  it('a refusal from the server shows in the preview and Send stays off', async () => {
    const a = api([lead()], null, { previewInvite: vi.fn(async () => ({ to: 'layla@acme.ae', from: 'x', replyTo: 'x', subject: 'Your Tovira beta invite', html: '<p/>', text: '', refusal: { code: 'has_account', message: 'They already have an account.' } })) });
    render(<LeadsPanel api={a} onSignedOut={vi.fn()} now={() => NOW} />);
    await userEvent.click(within(await screen.findByTestId('lead-1')).getByRole('button', { name: 'Send invite email' }));
    expect(await screen.findByText('They already have an account.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });
  it('Add test lead: added, and marked Test', async () => {
    const a = api([lead()]);
    render(<LeadsPanel api={a} onSignedOut={vi.fn()} now={() => NOW} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Add test lead' }));
    await userEvent.type(screen.getByLabelText('Name'), 'Wabil Ahmed');
    await userEvent.type(screen.getByLabelText('Email'), 'wabil@prospera-technologies.com');
    await userEvent.click(screen.getAllByRole('button', { name: 'Add test lead' }).at(-1)!);
    expect(a.addTestLead).toHaveBeenCalledWith(expect.objectContaining({ name: 'Wabil Ahmed', email: 'wabil@prospera-technologies.com' }));
    expect(await screen.findByTestId('lead-9')).toHaveTextContent('Test');
  });
});
