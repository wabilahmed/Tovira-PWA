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
type LeadsApi = Pick<AdminApi, 'leads' | 'updateLead' | 'inviteLead' | 'downloadCsv'>;
function api(leads: HotLead[], banner: string | null = null, over: Partial<LeadsApi> = {}): LeadsApi {
  const view = (): LeadsView => ({ leads, newCount: leads.filter((l) => l.status === 'new').length, countries: ['AE', 'GB'], sync: { cursor: null, lastRunAt: NOW, lastStatus: 'ok', banner } });
  return {
    leads: vi.fn(async () => view()),
    updateLead: vi.fn(async (id, patch) => ({ ...leads.find((l) => l.id === id)!, ...patch })),
    inviteLead: vi.fn(async (id) => ({ ...leads.find((l) => l.id === id)!, status: 'invited' as const, accessRequestId: 'r1' })),
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

  it('Invite to beta (after a confirm) marks the lead Invited and points to the Access tab', async () => {
    const a = api([lead()]);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<LeadsPanel api={a} onSignedOut={vi.fn()} now={() => NOW} />);
    await userEvent.click(within(await screen.findByTestId('lead-1')).getByRole('button', { name: 'Invite to beta' }));
    expect(a.inviteLead).toHaveBeenCalledWith('1');
    expect(await screen.findByText(/added to Access as a pending request/i)).toBeInTheDocument();
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
