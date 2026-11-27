import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RequestAccess } from './RequestAccess.js';
import { toE164 } from './whatsappNumber.js';
import type { AccessRequestClient } from './requestAccessClient.js';

/**
 * [P75 · owner] The request form takes a required "WhatsApp number" with a country-code picker. No country is chosen
 * for the rep and none is named in the copy. The number goes to the server in E.164; the server checks it again.
 */
const makeClient = (): AccessRequestClient & { submit: ReturnType<typeof vi.fn> } => ({ submit: vi.fn().mockResolvedValue({ id: 'req-1' }) });

async function fillRest(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.type(screen.getByLabelText('Full name'), 'Dana Rep');
  await user.type(screen.getByLabelText('Work email'), 'dana@brokerage.ae');
  await user.type(screen.getByLabelText('Phone'), '+971 50 123 4567');
  await user.type(screen.getByLabelText('Company name'), 'Meridian');
  await user.type(screen.getByLabelText('Role / job title'), 'Broker');
  await user.click(screen.getByLabelText('I am employed by it'));
  await user.click(screen.getByLabelText('My own clients. I hold the relationship directly.'));
  await user.click(screen.getByLabelText('50–200'));
  await user.click(screen.getByLabelText('Insurance'));
  await user.click(screen.getByRole('checkbox'));
}

describe('[P75] toE164', () => {
  it('a national number with its country: E.164, the trunk 0 dropped', () => {
    expect(toE164('GB', '07911 123456')).toEqual({ ok: true, e164: '+447911123456' });
    expect(toE164('AE', '050 123 4567')).toEqual({ ok: true, e164: '+971501234567' });
    expect(toE164('IN', '98000 00001')).toEqual({ ok: true, e164: '+919800000001' });
  });
  it('a full international number typed in the field wins over the picker', () => {
    expect(toE164('', '+44 7911 123456')).toEqual({ ok: true, e164: '+447911123456' });
    expect(toE164('AE', '0044 7911 123456')).toEqual({ ok: true, e164: '+447911123456' });
  });
  it('NEGATIVE: no country, nothing typed, letters, or too short for the country are refused', () => {
    expect(toE164('', '07911 123456').ok).toBe(false);
    expect(toE164('GB', '').ok).toBe(false);
    expect(toE164('GB', 'call me').ok).toBe(false);
    expect(toE164('AE', '050 12').ok).toBe(false);
  });
});

describe('[P75] the form field', () => {
  it('a WhatsApp number field with a country-code picker; no country chosen and none named in the copy', () => {
    render(<RequestAccess client={makeClient()} />);
    const picker = screen.getByLabelText('Country code') as HTMLSelectElement;
    expect(picker.value).toBe('');
    expect(picker.options[0]!.textContent).toBe('Country code');
    expect([...picker.options].some((o) => o.textContent === 'United Kingdom +44')).toBe(true);
    expect([...picker.options].some((o) => o.textContent === 'United Arab Emirates +971')).toBe(true);
    const field = screen.getByLabelText('WhatsApp number') as HTMLInputElement;
    expect(field).toBeRequired();
    expect(field.placeholder).not.toMatch(/\+|971|44/);
    const hint = screen.getByTestId('whatsapp-hint').textContent!;
    expect(hint).toMatch(/verify/i);
    expect(hint).not.toMatch(/UAE|Emirates|\+971|Dubai/);
  });
  // [P89 · owner, 27 Nov] "No copy may tell visitors to send chats to a WhatsApp number while the number is limited to
  // my account": the hint keeps the verification and drops "so you can send chats straight to Tovira"
  it('[P89] NEGATIVE: the hint does not tell a visitor to send chats to the WhatsApp number', () => {
    render(<RequestAccess client={makeClient()} />);
    const hint = screen.getByTestId('whatsapp-hint').textContent!;
    expect(hint).toBe('Once you’re approved, you’ll verify this number with one WhatsApp message.');
    expect(hint).not.toMatch(/send chats|send (it|them) to/i);
  });

  it('submits the number in E.164', async () => {
    const user = userEvent.setup();
    const client = makeClient();
    render(<RequestAccess client={client} />);
    await fillRest(user);
    await user.selectOptions(screen.getByLabelText('Country code'), 'GB');
    await user.type(screen.getByLabelText('WhatsApp number'), '07911 123456');
    await user.click(screen.getByRole('button', { name: /request access/i }));
    await waitFor(() => expect(client.submit).toHaveBeenCalledTimes(1));
    expect(client.submit.mock.calls[0]![0]).toMatchObject({ whatsappNumber: '+447911123456' });
  });

  it('NEGATIVE: no number, or no country code, or a wrong number: not sent, and the rep is told what to fix', async () => {
    const user = userEvent.setup();
    const client = makeClient();
    render(<RequestAccess client={client} />);
    await fillRest(user);
    await user.click(screen.getByRole('button', { name: /request access/i }));
    expect(screen.getByRole('alert')).toHaveTextContent('Please choose your country code and enter your WhatsApp number.');
    await user.type(screen.getByLabelText('WhatsApp number'), '07911 123456');
    await user.click(screen.getByRole('button', { name: /request access/i }));
    expect(screen.getByRole('alert')).toHaveTextContent('Please choose your country code and enter your WhatsApp number.');
    await user.selectOptions(screen.getByLabelText('Country code'), 'AE');
    await user.clear(screen.getByLabelText('WhatsApp number'));
    await user.type(screen.getByLabelText('WhatsApp number'), '050 12');
    await user.click(screen.getByRole('button', { name: /request access/i }));
    expect(screen.getByRole('alert')).toHaveTextContent('That doesn’t look like a WhatsApp number. Check the country code and the number.');
    expect(client.submit).not.toHaveBeenCalled();
  });
});
