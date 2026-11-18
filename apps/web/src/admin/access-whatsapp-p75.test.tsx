import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AccessPanel } from './AccessPanel.js';
import type { AccessRequest, AdminApi } from './adminClient.js';

/**
 * [P75 · owner] Admin → Access: the WhatsApp number next to each request, and each account's WhatsApp status
 * (Not verified / Verified with the date).
 */
const req = (o: Partial<AccessRequest> = {}): AccessRequest => ({
  id: 'r1', fullName: 'Sara Khan', workEmail: 'sara@khanrealty.ae', phone: '+971501234567', companyName: 'Khan Realty', roleTitle: 'Broker',
  ownership: 'owns_or_manages', tradeLicenceNumber: 'TL-123', conversationOwnership: 'own_clients', conversationOwnershipOther: null,
  expectedVolume: '50_200', industry: 'property', industryOther: null, source: 'form', createdAt: Date.parse('2026-11-17T08:00:00Z'), status: 'pending',
  reviewedAt: null, reviewedNote: null, linkedUserId: null, whatsappNumber: '+447911123456', whatsapp: null, ...o,
});
const api = (requests: AccessRequest[]): Pick<AdminApi, 'accessList' | 'approve' | 'reject' | 'reinvite'> => ({
  accessList: vi.fn(async (status?: string) => requests.filter((r) => !status || r.status === status)),
  approve: vi.fn(), reject: vi.fn(), reinvite: vi.fn(),
});

describe('[P75] Admin → Access: WhatsApp', () => {
  it('a pending request shows its WhatsApp number (formatted), no status yet (no account)', async () => {
    render(<AccessPanel api={api([req()])} onSignedOut={vi.fn()} />);
    const card = await screen.findByTestId('request-r1');
    expect(within(card).getByTestId('whatsapp')).toHaveTextContent('WhatsApp: +44 7911 123456');
    expect(within(card).queryByTestId('whatsapp-status')).toBeNull();
  });

  it('an account: Not verified, then Verified with the date (and the number verified, when it differs)', async () => {
    const rows = [
      req({ id: 'a', status: 'invited', linkedUserId: 'u1', whatsapp: { verified: false, phone: null, verifiedAt: null } }),
      req({ id: 'b', status: 'activated', linkedUserId: 'u2', whatsapp: { verified: true, phone: '+447911123456', verifiedAt: Date.UTC(2026, 10, 18, 9) } }),
      req({ id: 'c', status: 'activated', linkedUserId: 'u3', whatsapp: { verified: true, phone: '+971501234567', verifiedAt: Date.UTC(2026, 10, 18, 9) } }),
    ];
    render(<AccessPanel api={api(rows)} onSignedOut={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'All' }));
    expect(within(await screen.findByTestId('request-a')).getByTestId('whatsapp-status')).toHaveTextContent('Not verified');
    expect(within(screen.getByTestId('request-b')).getByTestId('whatsapp-status')).toHaveTextContent('Verified 18 Nov 2026');
    expect(within(screen.getByTestId('request-c')).getByTestId('whatsapp-status')).toHaveTextContent('Verified 18 Nov 2026 on +971 50 123 4567');
  });

  it('a request made before the field existed says Not given', async () => {
    render(<AccessPanel api={api([req({ whatsappNumber: null })])} onSignedOut={vi.fn()} />);
    expect(within(await screen.findByTestId('request-r1')).getByTestId('whatsapp')).toHaveTextContent('WhatsApp: Not given');
  });
});
