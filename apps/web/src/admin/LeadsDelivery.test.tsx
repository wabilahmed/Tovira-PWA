import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LeadsPanel } from './LeadsPanel.js';
import type { AdminApi, HotLead, LeadsView } from './adminClient.js';

// [P63-9 · owner] Each lead card shows the invite email's delivery: delivered, bounced or marked spam (never opens).
// Until the delivery webhook is connected, an invited lead's card says so instead.
const NOW = Date.parse('2026-11-05T12:00:00Z');
const lead = (o: Partial<HotLead> = {}): HotLead => ({ id: '1', personId: 'p1', campaignId: 7, campaignName: 'Dubai brokers', name: 'Layla Nasser', email: 'layla@acme.ae', jobTitle: 'Head of Sales', companyName: 'Acme', companyDomain: 'acme.ae', linkedinUrl: null, country: 'AE', phone: null, whyHot: 'Yes', becameHotAt: NOW - 3_600_000, erased: false, status: 'invited', notes: null, accessRequestId: null, firstSeenAt: NOW, updatedAt: NOW, inviteSentAt: NOW - 86_400_000, ...o });
type LeadsApi = Pick<AdminApi, 'leads' | 'updateLead' | 'previewInvite' | 'sendInvite' | 'addTestLead' | 'downloadCsv'>;
const api = (leads: HotLead[], deliveryConnected: boolean): LeadsApi => ({
  leads: vi.fn(async (): Promise<LeadsView> => ({ leads, newCount: 0, countries: [], sync: { cursor: null, lastRunAt: NOW, lastStatus: 'ok', banner: null }, deliveryConnected })),
  updateLead: vi.fn(), previewInvite: vi.fn(), sendInvite: vi.fn(), addTestLead: vi.fn(), downloadCsv: vi.fn(),
});

describe('[P63-9] the invite email\'s delivery on the lead card', () => {
  it('delivered, bounced and marked spam, with the date', async () => {
    render(<LeadsPanel api={api([
      lead({ id: '1', inviteDelivery: 'delivered', inviteDeliveryAt: NOW - 86_000_000 }),
      lead({ id: '2', inviteDelivery: 'bounced', inviteDeliveryAt: NOW - 86_000_000 }),
      lead({ id: '3', inviteDelivery: 'complained', inviteDeliveryAt: NOW - 3_600_000 }),
    ], true)} onSignedOut={vi.fn()} now={() => NOW} />);
    expect(await screen.findByTestId('delivery-1')).toHaveTextContent('Email delivered 4 Nov');
    expect(screen.getByTestId('delivery-2')).toHaveTextContent('Email bounced 4 Nov');
    expect(screen.getByTestId('delivery-3')).toHaveTextContent('Marked as spam 5 Nov');
  });
  it('NEGATIVE: connected, but no event yet: "Delivery not reported yet"; never an open or a click', async () => {
    render(<LeadsPanel api={api([lead()], true)} onSignedOut={vi.fn()} now={() => NOW} />);
    expect(await screen.findByTestId('delivery-1')).toHaveTextContent('Delivery not reported yet');
    expect(screen.queryByText(/opened|clicked/i)).toBeNull();
  });
  it('NEGATIVE: not connected yet: says so, and shows no status', async () => {
    render(<LeadsPanel api={api([lead({ inviteDelivery: 'delivered' })], false)} onSignedOut={vi.fn()} now={() => NOW} />);
    expect(await screen.findByTestId('delivery-1')).toHaveTextContent('Delivery status is not connected yet');
  });
  it('NEGATIVE: a lead who was never invited shows no delivery line', async () => {
    render(<LeadsPanel api={api([lead({ status: 'new', inviteSentAt: null })], true)} onSignedOut={vi.fn()} now={() => NOW} />);
    await screen.findByTestId('lead-1');
    expect(screen.queryByTestId('delivery-1')).toBeNull();
  });
});
