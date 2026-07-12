import { describe, it, expect, vi } from 'vitest';
import { WebPushSender } from './webpush-sender.js';

const opts = { publicKey: '', privateKey: '', subject: 'mailto:x@y.z' };
const sub = { endpoint: 'https://push.example/abc', keys: { p256dh: 'k', auth: 'a' } };

describe('WebPushSender', () => {
  it('sends the subscription + JSON payload via the send fn', async () => {
    const sendFn = vi.fn(async (_subscription: { endpoint: string }, _payload: string) => undefined);
    await new WebPushSender({ ...opts, sendFn }).send(sub, { title: 'T', body: 'B' });
    const [subscription, payload] = sendFn.mock.calls[0]!;
    expect(subscription.endpoint).toBe(sub.endpoint);
    expect(JSON.parse(payload as string)).toEqual({ title: 'T', body: 'B' });
  });

  it('propagates a failed send (caller treats push as best-effort)', async () => {
    const sendFn = vi.fn(async () => { throw new Error('gone'); });
    await expect(new WebPushSender({ ...opts, sendFn }).send(sub, { title: 'T', body: 'B' })).rejects.toThrow();
  });
});
