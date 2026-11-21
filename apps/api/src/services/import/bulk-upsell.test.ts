import { describe, it, expect } from 'vitest';
import { pickPack, buildUpsell, BulkUpsellService } from './bulk-upsell.js';
import { TOP_UP_OPTIONS } from '../../config.js';

// [BULK-IMPORT · RULING 2 → P83 · owner, 21 Nov] The upsell before Import (the batch has more messages to read than are
// left) and on the result (chats waited at the limit). Moved from AED shares to messages by the owner's decision: the
// packs are named by their messages (+1,500 / +3,000 / +5,000), the smallest pack that covers the shortfall is
// highlighted, and no price or AED value is in it (prices appear only on the purchase screen and at checkout).
describe('[P83] the bulk upsell, in messages', () => {
  it('pickPack returns the SMALLEST pack that covers the shortfall, else the largest', () => {
    expect(pickPack(100, TOP_UP_OPTIONS)!.id).toBe('topup_50');
    expect(pickPack(1500, TOP_UP_OPTIONS)!.id).toBe('topup_50');
    expect(pickPack(1501, TOP_UP_OPTIONS)!.id).toBe('topup_100');
    expect(pickPack(4000, TOP_UP_OPTIONS)!.id).toBe('topup_150');
    expect(pickPack(90_000, TOP_UP_OPTIONS)!.id).toBe('topup_150');
    expect(pickPack(5, [])).toBeNull();
  });

  it('buildUpsell: a shortfall in messages, the covering pack highlighted, and no price or AED in it', () => {
    const u = buildUpsell({ messagesToRead: 3000, messagesLeft: 500, canTopUp: true, n: 8 }, TOP_UP_OPTIONS);
    expect(u).toMatchObject({ shortfall: true, n: 8, canTopUp: true, recommendedOptionId: 'topup_100', messagesToRead: 3000, messagesLeft: 500 });
    expect(u.options).toEqual([
      { id: 'topup_50', label: '+1,500 messages', messages: 1500 },
      { id: 'topup_100', label: '+3,000 messages', messages: 3000 },
      { id: 'topup_150', label: '+5,000 messages', messages: 5000 },
    ]);
    expect(JSON.stringify(u)).not.toMatch(/price|aed/i);
  });

  it('NEGATIVE: no shortfall when the batch fits what is left', () => {
    const u = buildUpsell({ messagesToRead: 400, messagesLeft: 500, canTopUp: true, n: 3 }, TOP_UP_OPTIONS);
    expect([u.shortfall, u.recommendedOptionId]).toEqual([false, null]);
  });

  it('NEGATIVE: a trial account gets no packs (the web shows Subscribe)', () => {
    const u = buildUpsell({ messagesToRead: 3000, messagesLeft: 500, canTopUp: false, n: 8 }, TOP_UP_OPTIONS);
    expect([u.shortfall, u.canTopUp, u.options, u.recommendedOptionId]).toEqual([true, false, [], null]);
  });

  it('the service reads the live messages left; the result offers packs for the chats that waited', async () => {
    const svc = new BulkUpsellService({ topUpOptions: TOP_UP_OPTIONS, messagesLeft: async () => 200, canTopUp: async () => true });
    expect((await svc.forBatch('u', 1000, 2)).recommendedOptionId).toBe('topup_50');
    const r = await svc.forResult('u', 4);
    expect([r.shortfall, r.n, r.options.length]).toEqual([true, 4, 3]);
  });
});
