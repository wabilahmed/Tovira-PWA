import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CardScan, type CardsApi } from './CardScan.js';
import type { CardScanResult } from './cardsClient.js';
import { LOCKED } from '../billing/gated.js';

const file = (): File => new File(['imgbytes'], 'card.png', { type: 'image/png' });
const makeApi = (result: CardScanResult | null): CardsApi => ({ scan: vi.fn().mockResolvedValue(result) });

describe('<CardScan>', () => {
  // [LOCKED-EMBEDDED] a 402 renders the shared Locked state (not the scan error)
  // and Subscribe reaches Billing.
  it('renders <Locked> on a 402 and Subscribe reaches Billing', async () => {
    const user = userEvent.setup();
    const onSubscribe = vi.fn();
    render(<CardScan api={{ scan: vi.fn().mockResolvedValue(LOCKED) }} onCreateClient={vi.fn()} onSubscribe={onSubscribe} />);
    await user.upload(screen.getByLabelText(/business card photo/i), file());
    expect(await screen.findByText(/your trial has ended/i)).toBeInTheDocument();
    expect(screen.queryByText(/couldn't read that image/i)).not.toBeInTheDocument(); // not the error path
    await user.click(screen.getByRole('button', { name: /subscribe/i }));
    expect(onSubscribe).toHaveBeenCalled();
  });

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

  // [P4-7] the scanned phone is offered to confirm (editable) and saved with the
  // client — never saved silently.
  it('offers the scanned phone to confirm and saves it with the client', async () => {
    const user = userEvent.setup();
    const onCreateClient = vi.fn().mockResolvedValue({ id: 'c1', name: 'Sara Lee' });
    render(<CardScan api={makeApi({ isCard: true, contact: { name: 'Sara Lee', title: null, phone: '+971 50 123 4567', email: null } })} onCreateClient={onCreateClient} />);
    await user.upload(screen.getByLabelText(/business card photo/i), file());
    const phoneInput = await screen.findByLabelText(/phone/i);
    expect(phoneInput).toHaveValue('+971 50 123 4567'); // pre-filled from the scan
    await user.click(screen.getByRole('button', { name: /create client from card/i }));
    await waitFor(() => expect(onCreateClient).toHaveBeenCalledWith('Sara Lee', '+971 50 123 4567'));
  });

  it('lets the rep correct the scanned phone before saving', async () => {
    const user = userEvent.setup();
    const onCreateClient = vi.fn().mockResolvedValue({ id: 'c1', name: 'Sara Lee' });
    render(<CardScan api={makeApi({ isCard: true, contact: { name: 'Sara Lee', title: null, phone: '971 (bad)', email: null } })} onCreateClient={onCreateClient} />);
    await user.upload(screen.getByLabelText(/business card photo/i), file());
    const phoneInput = await screen.findByLabelText(/phone/i);
    await user.clear(phoneInput);
    await user.type(phoneInput, '+971509999999');
    await user.click(screen.getByRole('button', { name: /create client from card/i }));
    await waitFor(() => expect(onCreateClient).toHaveBeenCalledWith('Sara Lee', '+971509999999'));
  });

  // [FLOWS-4] the scanned title + email must NOT be discarded on create — they
  // flow through so the app can preserve them (as a note extraction files).
  it('preserves the scanned title and email on create (does not discard them)', async () => {
    const user = userEvent.setup();
    const onCreateClient = vi.fn().mockResolvedValue({ id: 'c1', name: 'Sara Lee' });
    render(<CardScan api={makeApi({ isCard: true, contact: { name: 'Sara Lee', title: 'Ops Lead', phone: '+971 50 111 2222', email: 's@acme.test' } })} onCreateClient={onCreateClient} />);
    await user.upload(screen.getByLabelText(/business card photo/i), file());
    await user.click(await screen.findByRole('button', { name: /create client from card/i }));
    await waitFor(() => expect(onCreateClient).toHaveBeenCalledWith('Sara Lee', '+971 50 111 2222', { title: 'Ops Lead', email: 's@acme.test' }));
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
