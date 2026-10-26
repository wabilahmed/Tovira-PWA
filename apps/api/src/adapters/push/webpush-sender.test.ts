import { describe, it, expect, vi } from 'vitest';
import { WebPushSender } from './webpush-sender.js';
import { PushSubscriptionGoneError } from '../../ports/push.js';

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

  // [P46-2] 404 / 410 from the push service: the subscription is gone, so the caller deletes it.
  it('a 410 or 404 from the push service is a PushSubscriptionGoneError; NEGATIVE: a 500 is not', async () => {
    for (const statusCode of [404, 410]) {
      const sendFn = vi.fn(async () => { throw Object.assign(new Error('gone'), { statusCode }); });
      await expect(new WebPushSender({ ...opts, sendFn }).send(sub, { title: 'T', body: 'B' })).rejects.toBeInstanceOf(PushSubscriptionGoneError);
    }
    const sendFn = vi.fn(async () => { throw Object.assign(new Error('down'), { statusCode: 500 }); });
    await expect(new WebPushSender({ ...opts, sendFn }).send(sub, { title: 'T', body: 'B' })).rejects.not.toBeInstanceOf(PushSubscriptionGoneError);
  });
});
