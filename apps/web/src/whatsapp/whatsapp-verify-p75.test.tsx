import { describe, it, expect, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WhatsAppStatusProvider } from './useWhatsApp.js';
import { WhatsAppBanner } from './WhatsAppBanner.js';
import { WhatsAppSetting } from './WhatsAppSetting.js';
import { WhatsAppFirstStep } from './WhatsAppFirstStep.js';
import type { WhatsAppApi, WhatsAppStatus } from './whatsappClient.js';

/**
 * [P75 · owner] After approval the rep verifies their WhatsApp from four places, all the P67 flow (a wa.me link with
 * "LINK <code>" to Tovira's number, 15 minutes, single use), the number pre-filled from the request: the invite email
 * (API test), the first sign-in step ("Do it later"), Settings → WhatsApp, and a banner at the top of Today on every
 * visit until verified. The banner can't be dismissed and goes for good once verified, without a page reload.
 */
const BIZ = '+971500000001';
const REQUESTED = '+971501234567';
const unverified: WhatsAppStatus = { linked: null, businessNumber: BIZ, requestedNumber: REQUESTED, awaitingConfirm: null };
const verified: WhatsAppStatus = { linked: { phone: REQUESTED, linkedAt: Date.UTC(2026, 10, 18, 9, 30) }, businessNumber: BIZ, requestedNumber: REQUESTED, awaitingConfirm: null };
const OFF: WhatsAppApi = { status: async () => null, startLink: async () => ({ ok: false, message: 'x' }), unlink: async () => null, confirm: async () => null };

let codeSeq = 0;
function fakeApi(initial: WhatsAppStatus): WhatsAppApi & { s: WhatsAppStatus } {
  const api = {
    s: initial,
    status: vi.fn(async () => api.s),
    startLink: vi.fn(async (phone: string) => { const code = String(482190 + ++codeSeq); return { ok: true as const, code, phone, waLink: `https://wa.me/971500000001?text=LINK%20${code}`, expiresAt: Date.now() + 900_000 }; }),
    unlink: vi.fn(async () => { api.s = { ...api.s, linked: null }; return api.s; }),
    confirm: vi.fn(async (accept: boolean) => { api.s = accept && api.s.awaitingConfirm ? { ...api.s, linked: { phone: api.s.awaitingConfirm.phone, linkedAt: Date.UTC(2026, 10, 18, 9, 31) }, awaitingConfirm: null } : { ...api.s, awaitingConfirm: null }; return api.s; }),
  };
  return api;
}
const withProvider = (api: WhatsAppApi, ui: JSX.Element, pollMs = 20) => <WhatsAppStatusProvider api={api} pollMs={pollMs}>{ui}</WhatsAppStatusProvider>;
const focus = () => act(() => { window.dispatchEvent(new Event('focus')); });

describe('[P75] the Today banner', () => {
  it('shows "Verify your WhatsApp to send chats straight to Tovira." with Verify now while not verified', async () => {
    render(withProvider(fakeApi(unverified), <WhatsAppBanner />));
    const b = await screen.findByTestId('whatsapp-banner');
    expect(b).toHaveTextContent('Verify your WhatsApp to send chats straight to Tovira.');
    expect(within(b).getByRole('button', { name: 'Verify now' })).toBeInTheDocument();
  });

  it('NEGATIVE: it cannot be dismissed: no close, dismiss or later control, and it is back on every visit', async () => {
    const api = fakeApi(unverified);
    const { unmount } = render(withProvider(api, <WhatsAppBanner />));
    const b = await screen.findByTestId('whatsapp-banner');
    expect(within(b).getAllByRole('button').map((x) => x.textContent)).toEqual(['Verify now']);
    expect(within(b).queryByRole('button', { name: /close|dismiss|later|hide|×/i })).toBeNull();
    await userEvent.keyboard('{Escape}');
    expect(screen.getByTestId('whatsapp-banner')).toBeInTheDocument();
    unmount();
    render(withProvider(api, <WhatsAppBanner />)); // the next visit to Today
    expect(await screen.findByTestId('whatsapp-banner')).toBeInTheDocument();
  });

  it('Verify now opens the verify step with the number from the request and the code to send', async () => {
    const api = fakeApi(unverified);
    render(withProvider(api, <WhatsAppBanner />));
    await userEvent.click(await screen.findByRole('button', { name: 'Verify now' }));
    const sheet = await screen.findByTestId('whatsapp-verify');
    expect(sheet).toHaveTextContent('+971 50 123 4567');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Get my code' }));
    expect(api.startLink).toHaveBeenCalledWith(REQUESTED);
    expect(within(sheet).getByRole('link', { name: 'Open WhatsApp' }).getAttribute('href')).toMatch(/^https:\/\/wa\.me\/971500000001\?text=LINK%20\d{6}$/);
  });

  it('vanishes without a page reload once verified: on focus (back from WhatsApp)', async () => {
    const api = fakeApi(unverified);
    render(withProvider(api, <WhatsAppBanner />, 60_000));
    await screen.findByTestId('whatsapp-banner');
    api.s = verified;
    focus();
    await waitFor(() => expect(screen.queryByTestId('whatsapp-banner')).toBeNull());
    focus(); // and it stays gone
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByTestId('whatsapp-banner')).toBeNull();
  });

  it('vanishes without a page reload once verified: by polling while a code is out', async () => {
    const api = fakeApi(unverified);
    render(withProvider(api, <WhatsAppBanner />, 15));
    await userEvent.click(await screen.findByRole('button', { name: 'Verify now' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Get my code' }));
    api.s = verified; // the LINK message arrived from that number
    await waitFor(() => expect(screen.queryByTestId('whatsapp-banner')).toBeNull());
  });

  it('NEGATIVE: switched off (or not on the allowlist), or already verified: no banner', async () => {
    const { container } = render(withProvider(OFF, <WhatsAppBanner />));
    await new Promise((r) => setTimeout(r, 30));
    expect(container).toBeEmptyDOMElement();
    render(withProvider(fakeApi(verified), <WhatsAppBanner />));
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByTestId('whatsapp-banner')).toBeNull();
  });
});

describe('[P75] the verify step, wherever it is opened', () => {
  it('a code from a different number: asks the rep to confirm THAT number; Yes links it, and the banner goes', async () => {
    const api = fakeApi({ ...unverified, awaitingConfirm: { phone: '+447911123456' } });
    render(withProvider(api, <><WhatsAppBanner /><WhatsAppSetting /></>));
    const ask = await screen.findByTestId('whatsapp-confirm');
    expect(ask).toHaveTextContent('Your code came from +44 7911 123456, not +971 50 123 4567.');
    await userEvent.click(within(ask).getByRole('button', { name: 'Yes, use +44 7911 123456' }));
    expect(api.confirm).toHaveBeenCalledWith(true);
    await waitFor(() => expect(screen.queryByTestId('whatsapp-banner')).toBeNull());
    expect(screen.getByTestId('whatsapp-status')).toHaveTextContent('Verified on 18 Nov 2026');
    expect(screen.getByTestId('whatsapp-number')).toHaveTextContent('+44 7911 123456');
  });

  it('a code from a different number: No links nothing', async () => {
    const api = fakeApi({ ...unverified, awaitingConfirm: { phone: '+447911123456' } });
    render(withProvider(api, <WhatsAppSetting />));
    await userEvent.click(within(await screen.findByTestId('whatsapp-confirm')).getByRole('button', { name: 'No' }));
    expect(api.confirm).toHaveBeenCalledWith(false);
    await waitFor(() => expect(screen.queryByTestId('whatsapp-confirm')).toBeNull());
    expect(screen.getByTestId('whatsapp-status')).toHaveTextContent('Not verified');
  });

  it('tapping Verify now again asks for a new code (the server voids the old one) and shows the new one', async () => {
    const api = fakeApi(unverified);
    render(withProvider(api, <WhatsAppSetting />));
    await userEvent.click(await screen.findByRole('button', { name: 'Verify now' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Get my code' }));
    const first = screen.getByTestId('whatsapp-code').textContent;
    await userEvent.click(screen.getByRole('button', { name: 'Verify now' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Get my code' }));
    expect(api.startLink).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('whatsapp-code').textContent).not.toBe(first);
  });
});

describe('[P75] Settings → WhatsApp', () => {
  it('not verified: the status, the number from the request, Verify now and Change number', async () => {
    render(withProvider(fakeApi(unverified), <WhatsAppSetting />));
    const sec = await screen.findByTestId('whatsapp-setting');
    expect(within(sec).getByRole('heading', { name: 'WhatsApp' })).toBeInTheDocument();
    expect(screen.getByTestId('whatsapp-status')).toHaveTextContent('Not verified');
    expect(screen.getByTestId('whatsapp-number')).toHaveTextContent('+971 50 123 4567');
    expect(within(sec).getByRole('button', { name: 'Verify now' })).toBeInTheDocument();
    expect(within(sec).getByRole('button', { name: 'Change number' })).toBeInTheDocument();
  });

  it('verified: Verified on <date>, the number, and Change number (no Verify now)', async () => {
    render(withProvider(fakeApi(verified), <WhatsAppSetting />));
    const sec = await screen.findByTestId('whatsapp-setting');
    expect(screen.getByTestId('whatsapp-status')).toHaveTextContent('Verified on 18 Nov 2026');
    expect(screen.getByTestId('whatsapp-number')).toHaveTextContent('+971 50 123 4567');
    expect(within(sec).queryByRole('button', { name: 'Verify now' })).toBeNull();
    expect(within(sec).getByRole('button', { name: 'Change number' })).toBeInTheDocument();
    expect(sec).toHaveTextContent('Send any exported chat to Tovira on WhatsApp: +971 50 000 0001');
  });

  it('Change number: a new number gets its own code', async () => {
    const api = fakeApi(verified);
    render(withProvider(api, <WhatsAppSetting />));
    await userEvent.click(await screen.findByRole('button', { name: 'Change number' }));
    const field = screen.getByLabelText('WhatsApp number');
    await userEvent.clear(field);
    await userEvent.type(field, '+44 7911 123456');
    await userEvent.click(screen.getByRole('button', { name: 'Get my code' }));
    expect(api.startLink).toHaveBeenCalledWith('+44 7911 123456');
  });

  it('NEGATIVE: switched off: no WhatsApp section at all', async () => {
    const { container } = render(withProvider(OFF, <WhatsAppSetting />));
    await new Promise((r) => setTimeout(r, 30));
    expect(container).toBeEmptyDOMElement();
  });
});

describe('[P75] the first sign-in step', () => {
  it('"Verify your WhatsApp" with the number from the request, Verify now and Do it later', async () => {
    const onDone = vi.fn();
    render(withProvider(fakeApi(unverified), <WhatsAppFirstStep onDone={onDone} />));
    const step = await screen.findByTestId('whatsapp-first-step');
    expect(within(step).getByRole('heading', { name: 'Verify your WhatsApp' })).toBeInTheDocument();
    expect(step).toHaveTextContent('+971 50 123 4567');
    expect(within(step).getByRole('button', { name: 'Get my code' })).toBeInTheDocument();
    await userEvent.click(within(step).getByRole('button', { name: 'Do it later' }));
    expect(onDone).toHaveBeenCalled();
  });

  it('closes by itself once verified', async () => {
    const api = fakeApi(unverified);
    const onDone = vi.fn();
    render(withProvider(api, <WhatsAppFirstStep onDone={onDone} />));
    await screen.findByTestId('whatsapp-first-step');
    api.s = verified;
    focus();
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it('NEGATIVE: switched off, or already verified: the step is skipped', async () => {
    const onDone = vi.fn();
    render(withProvider(OFF, <WhatsAppFirstStep onDone={onDone} />));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const onDone2 = vi.fn();
    render(withProvider(fakeApi(verified), <WhatsAppFirstStep onDone={onDone2} />));
    await waitFor(() => expect(onDone2).toHaveBeenCalled());
  });
});
