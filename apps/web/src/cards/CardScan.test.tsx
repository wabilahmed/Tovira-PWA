import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CardScan, type CardsApi } from './CardScan.js';
import type { CardScanResult } from './cardsClient.js';

const file = (): File => new File(['imgbytes'], 'card.png', { type: 'image/png' });
const makeApi = (result: CardScanResult | null): CardsApi => ({ scan: vi.fn().mockResolvedValue(result) });

describe('<CardScan>', () => {
  it('scans a card and previews the structured contact', async () => {
    const user = userEvent.setup();
    render(<CardScan api={makeApi({ isCard: true, contact: { name: 'Sara Lee', title: 'Ops Lead', phone: '555', email: 's@acme.test' } })} onCreateClient={vi.fn()} />);
    await user.upload(screen.getByLabelText(/business card photo/i), file());
    expect(await screen.findByTestId('card-preview')).toHaveTextContent(/sara lee/i);
    expect(screen.getByText(/ops lead/i)).toBeInTheDocument();
  });

  // POSITIVE: confirming creates the client from the scanned name.
  it('creates a client from the card on confirm', async () => {
    const user = userEvent.setup();
    const onCreateClient = vi.fn().mockResolvedValue({ id: 'c1', name: 'Sara Lee' });
    render(<CardScan api={makeApi({ isCard: true, contact: { name: 'Sara Lee', title: null, phone: null, email: null } })} onCreateClient={onCreateClient} />);
    await user.upload(screen.getByLabelText(/business card photo/i), file());
    await user.click(await screen.findByRole('button', { name: /create client from card/i }));
    await waitFor(() => expect(onCreateClient).toHaveBeenCalledWith('Sara Lee'));
    expect(await screen.findByText(/contact created/i)).toBeInTheDocument();
  });

  // NEGATIVE: no name detected → cannot create silently.
  it('disables create when no name was detected', async () => {
    const user = userEvent.setup();
    render(<CardScan api={makeApi({ isCard: true, contact: { name: null, title: 'Someone', phone: null, email: null } })} onCreateClient={vi.fn()} />);
    await user.upload(screen.getByLabelText(/business card photo/i), file());
    expect(await screen.findByRole('button', { name: /create client from card/i })).toBeDisabled();
    expect(screen.getByText(/no name detected/i)).toBeInTheDocument();
  });

  // NEGATIVE: not a card → clear message, nothing to save.
  it('reports when the image is not a business card', async () => {
    const user = userEvent.setup();
    render(<CardScan api={makeApi({ isCard: false, contact: null })} onCreateClient={vi.fn()} />);
    await user.upload(screen.getByLabelText(/business card photo/i), file());
    expect(await screen.findByRole('alert')).toHaveTextContent(/business card/i);
    expect(screen.queryByTestId('card-preview')).toBeNull();
  });

  it('reports a scan error', async () => {
    const user = userEvent.setup();
    render(<CardScan api={makeApi(null)} onCreateClient={vi.fn()} />);
    await user.upload(screen.getByLabelText(/business card photo/i), file());
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't read/i);
  });
});
