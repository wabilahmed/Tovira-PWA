import { describe, it, expect, vi } from 'vitest';
import { StubEmailSender } from './stub-email-sender.js';
import { SesEmailSender } from './ses-email-sender.js';

describe('StubEmailSender', () => {
  it('records sends and filters by recipient (case-insensitive)', async () => {
    const email = new StubEmailSender();
    await email.send({ to: 'Rep@Example.com', subject: 'Welcome', text: 'Your trial has started.' });
    await email.send({ to: 'other@example.com', subject: 'Hi', text: 'x' });
    expect(email.sent).toHaveLength(2);
    const mine = email.to('rep@example.com');
    expect(mine).toHaveLength(1);
    expect(mine[0]!.subject).toBe('Welcome');
    expect(mine[0]!.text).toContain('trial has started');
  });
});

describe('SesEmailSender', () => {
  it('sends a plain-text email through the injected SES client', async () => {
    const send = vi.fn().mockResolvedValue({});
    const ses = new SesEmailSender({ client: { send }, from: 'Tovira <no-reply@tovira.com>' });
    await ses.send({ to: 'rep@example.com', subject: 'Trial ending', text: 'Two days left.' });
    expect(send).toHaveBeenCalledTimes(1);
    const command = send.mock.calls[0]![0] as { input: Record<string, unknown> };
    expect(command.input.FromEmailAddress).toBe('Tovira <no-reply@tovira.com>');
    expect((command.input.Destination as { ToAddresses: string[] }).ToAddresses).toEqual(['rep@example.com']);
    const content = command.input.Content as { Simple: { Subject: { Data: string }; Body: { Text: { Data: string }; Html?: unknown } } };
    expect(content.Simple.Subject.Data).toBe('Trial ending');
    expect(content.Simple.Body.Text.Data).toBe('Two days left.');
    expect(content.Simple.Body.Html).toBeUndefined(); // plain-text only when no html
  });
});
