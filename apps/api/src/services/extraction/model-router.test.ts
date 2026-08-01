import { describe, it, expect, vi } from 'vitest';
import { BillingModelRouter } from './model-router.js';
import type { ModelClient } from '../../ports/model.js';

const stub: ModelClient = { complete: async () => ({ text: '{}' }) };
const production = { model: stub, modelId: 'claude-haiku-4-5-20251001' };
const trial = { model: stub, modelId: 'claude-sonnet-5' };

describe('BillingModelRouter (P5-7)', () => {
  it('routes trial accounts to the Sonnet route', async () => {
    const router = new BillingModelRouter(async () => 'trialing', production, trial, () => 1000);
    expect((await router.resolve('u1')).modelId).toBe('claude-sonnet-5');
  });

  it('routes paid and non-trial accounts to the production route', async () => {
    for (const status of ['active', 'none', 'past_due', 'canceled']) {
      const router = new BillingModelRouter(async () => status, production, trial, () => 1000);
      expect((await router.resolve('u1')).modelId).toBe('claude-haiku-4-5-20251001');
    }
  });

  it('passes the current time to the status lookup', async () => {
    const statusOf = vi.fn().mockResolvedValue('active');
    const router = new BillingModelRouter(statusOf, production, trial, () => 4242);
    await router.resolve('u1');
    expect(statusOf).toHaveBeenCalledWith('u1', 4242);
  });
});
