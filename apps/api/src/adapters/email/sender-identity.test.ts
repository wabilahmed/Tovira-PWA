import { describe, it, expect, vi } from 'vitest';
import { ResendEmailSender } from './resend-email-sender.js';
import { SesEmailSender } from './ses-email-sender.js';
import { FOUNDER_FROM, FOUNDER_EMAIL } from '../../services/email/contact.js';

// [P58-1 · owner] One email (the hot-lead beta invite) comes from the founder: From "Wabil Ahmed, Tovira"
// <wabil@tovira.io>, and replies go to the same address. Every other email keeps EMAIL_FROM and hello@tovira.io. A
// per-message sender must be on our own domain (tovira.io); anything else is refused before it is sent.
describe('[P58-1] a per-message sender', () => {
  it('the founder identity: a quoted display name (it has a comma) on tovira.io', () => {
    expect(FOUNDER_FROM).toBe('"Wabil Ahmed, Tovira" <wabil@tovira.io>');
    expect(FOUNDER_EMAIL).toBe('wabil@tovira.io');
  });
  it('Resend: from and reply_to come from the message when it has them', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    await new ResendEmailSender({ apiKey: 'k', from: 'Tovira <hello@tovira.io>', fetchImpl }).send({ to: 'lead@example.com', subject: 's', text: 't', from: FOUNDER_FROM, replyTo: FOUNDER_EMAIL });
    expect(JSON.parse(fetchImpl.mock.calls[0]![1].body)).toMatchObject({ from: '"Wabil Ahmed, Tovira" <wabil@tovira.io>', reply_to: 'wabil@tovira.io' });
  });
  it('Resend: without them, EMAIL_FROM and hello@tovira.io as before', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    await new ResendEmailSender({ apiKey: 'k', from: 'Tovira <hello@tovira.io>', fetchImpl }).send({ to: 'a@example.com', subject: 's', text: 't' });
    expect(JSON.parse(fetchImpl.mock.calls[0]![1].body)).toMatchObject({ from: 'Tovira <hello@tovira.io>', reply_to: 'hello@tovira.io' });
  });
  it('SES: the same', async () => {
    const send = vi.fn().mockResolvedValue({});
    await new SesEmailSender({ client: { send } as never, from: 'Tovira <hello@tovira.io>' }).send({ to: 'lead@example.com', subject: 's', text: 't', from: FOUNDER_FROM, replyTo: FOUNDER_EMAIL });
    expect(send.mock.calls[0]![0].input).toMatchObject({ FromEmailAddress: FOUNDER_FROM, ReplyToAddresses: [FOUNDER_EMAIL] });
  });
  it('NEGATIVE: a per-message From or Reply-To off our domain is refused, nothing sent', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    const r = new ResendEmailSender({ apiKey: 'k', from: 'Tovira <hello@tovira.io>', fetchImpl });
    await expect(r.send({ to: 'a@example.com', subject: 's', text: 't', from: 'Wabil <wabil@gmail.com>' })).rejects.toThrow(/our own domain/);
    await expect(r.send({ to: 'a@example.com', subject: 's', text: 't', replyTo: 'wabil@tovira.io.evil.com' })).rejects.toThrow(/our own domain/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
