import { describe, it, expect, vi } from 'vitest';
import { ResendEmailSender } from './resend-email-sender.js';

describe('ResendEmailSender', () => {
  it('POSTs to the Resend API with bearer auth and the message', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{"id":"e1"}', { status: 200 }));
    const sender = new ResendEmailSender({ apiKey: 're_test', from: 'Tovira <no-reply@tovira.io>', fetchImpl });

    await sender.send({ to: 'a@example.com', subject: 'Hi', text: 'body', html: '<p>body</p>' });

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.method).toBe('POST');
    expect(init.headers.authorization).toBe('Bearer re_test');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ from: 'Tovira <no-reply@tovira.io>', to: ['a@example.com'], subject: 'Hi', text: 'body', html: '<p>body</p>' });
  });

  it('omits html when the message has none', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    await new ResendEmailSender({ apiKey: 'k', from: 'f', fetchImpl }).send({ to: 't', subject: 's', text: 't' });
    expect(JSON.parse(fetchImpl.mock.calls[0]![1].body)).not.toHaveProperty('html');
  });

  it('throws with the status on a non-2xx response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('bad domain', { status: 422 }));
    await expect(
      new ResendEmailSender({ apiKey: 'k', from: 'f', fetchImpl }).send({ to: 't', subject: 's', text: 't' }),
    ).rejects.toThrow(/resend send failed: 422/);
  });
});
