import { describe, it, expect } from 'vitest';
import { extractionBlockReason } from './notes-routes.js';
import type { NoteRouteDeps } from './notes-routes.js';

// [IMP-17] Why a pending note can't be read right now (billing). The sweep silently skips a blocked
// account, so this reason is what lets the book explain the hold instead of spinning on "queued…".
function deps(over: { status?: string; allowanceExhausted?: boolean }): NoteRouteDeps {
  return {
    billing: over.status !== undefined
      ? ({ entitlement: async () => ({ status: over.status, entitled: true }) } as unknown as NoteRouteDeps['billing'])
      : undefined,
    allowanceExhausted: over.allowanceExhausted !== undefined ? async () => over.allowanceExhausted! : undefined,
  } as unknown as NoteRouteDeps;
}

describe('[IMP-17] extractionBlockReason', () => {
  it('maps a failed/suspended payment to "payment" (update card)', async () => {
    expect(await extractionBlockReason(deps({ status: 'payment_failed' }), 'u')).toBe('payment');
    expect(await extractionBlockReason(deps({ status: 'suspended' }), 'u')).toBe('payment');
  });

  it('maps an ended sub / lapsed trial to "subscribe"', async () => {
    for (const s of ['ended', 'trial_expired', 'none', 'canceled', 'past_due']) {
      expect(await extractionBlockReason(deps({ status: s }), 'u')).toBe('subscribe');
    }
  });

  it('maps a spent allowance (while otherwise entitled) to "allowance"', async () => {
    expect(await extractionBlockReason(deps({ status: 'active', allowanceExhausted: true }), 'u')).toBe('allowance');
    expect(await extractionBlockReason(deps({ status: 'trialing', allowanceExhausted: true }), 'u')).toBe('allowance');
  });

  it('returns null when the account can extract (active/trialing, allowance left)', async () => {
    expect(await extractionBlockReason(deps({ status: 'active', allowanceExhausted: false }), 'u')).toBeNull();
    expect(await extractionBlockReason(deps({ status: 'trialing' }), 'u')).toBeNull();
    expect(await extractionBlockReason(deps({}), 'u')).toBeNull();
  });
});
