import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthService } from '../services/auth/auth-service.js';
import type { BillingService } from '../services/billing/billing-service.js';
import type { AllowanceStatusService } from '../services/spend/allowance-status.js';
import { extractToken, sendJson } from './helpers.js';
import { TOP_UP_OPTIONS, CUSTOM_PACK, MONTHLY_MESSAGES } from '../config.js';

export interface AllowanceRouteDeps {
  auth: AuthService;
  allowanceStatus?: AllowanceStatusService;
  billing?: BillingService;
  /** [AUDIT item 4] The ops AI-pause kill switch (already cached ~30s). Exposed so the app can show a
   *  slim "AI processing is delayed" banner instead of leaving notes silently pending. Optional. */
  aiPaused?: () => Promise<boolean>;
}

/**
 * [USAGE-ALLOWANCE · D3/D8/D9/D10] GET /allowance/status — the ONE thing the meter needs: a percentage
 * (rounded down, never 100% until AI has stopped), whether AI is paused, when it resets, and — only for
 * a subscribed account (D10: no top-ups in trial) — the top-up options. No dirhams, tokens, or per-action
 * cost ever leave the server (D3).
 */
export async function handleAllowanceRoute(req: IncomingMessage, res: ServerResponse, deps: AllowanceRouteDeps): Promise<boolean> {
  const method = req.method ?? 'GET';
  const path = (req.url ?? '/').split('?')[0]!;
  if (!(method === 'GET' && path === '/allowance/status')) return false;

  const identity = await deps.auth.authenticate(extractToken(req));
  if (!identity) {
    sendJson(res, 401, { error: 'unauthorized' });
    return true;
  }
  const aiPaused = deps.aiPaused ? await deps.aiPaused() : false; // [AUDIT item 4] ops kill switch (30s-cached)
  if (!deps.allowanceStatus) {
    sendJson(res, 200, { messagesAllowance: MONTHLY_MESSAGES, messagesUsed: 0, messagesTotal: MONTHLY_MESSAGES, messagesLeft: MONTHLY_MESSAGES, packMessagesLeft: 0, lastTopupMessages: null, exhausted: false, trial: false, planMessages: MONTHLY_MESSAGES, timeZone: null, resetAt: null, canTopUp: false, options: [], custom: null, aiPaused, subscription: null });
    return true;
  }
  const s = await deps.allowanceStatus.status(identity.userId);
  // D10: only a subscribed (active) account may buy top-ups — a trial has no card on file.
  const ent = deps.billing ? await deps.billing.entitlement(identity.userId, Date.now()) : null;
  const canTopUp = ent?.status === 'active';
  // [P83 · owner] Messages only: what was read, what is left (the month's, then packs), and what the last pack added.
  // `exhausted` is true when imports stop: no messages left, or the money gate behind them has stopped.
  sendJson(res, 200, {
    messagesAllowance: s.messagesAllowance,
    messagesUsed: s.messagesUsed,
    messagesTotal: s.messagesTotal,
    messagesLeft: s.messagesLeft,
    packMessagesLeft: s.packMessagesLeft,
    lastTopupMessages: s.lastTopupMessages,
    exhausted: s.exhausted || s.messagesExhausted,
    trial: s.trial, // [P84-5] the trial's 5,000 (no monthly reset)
    planMessages: MONTHLY_MESSAGES, // [P84-5] what subscribing gives: 10,000 a month
    timeZone: await deps.auth.timezoneFor(identity.userId).catch(() => null), // [P84-8] "Resets <date>" in the rep's own day
    messagesExhausted: s.messagesExhausted,
    resetAt: new Date(s.resetAtMs).toISOString(),
    canTopUp,
    // the purchase screen's packs and the custom range (prices are shown only there and at checkout)
    options: canTopUp ? TOP_UP_OPTIONS.map((o) => ({ id: o.id, label: o.label, messages: o.messages, priceAed: o.priceAed })) : [],
    custom: canTopUp ? { min: CUSTOM_PACK.min, max: CUSTOM_PACK.max, step: CUSTOM_PACK.step, bands: CUSTOM_PACK.bands.map((b) => ({ ...b })) } : null,
    aiPaused,
    subscription: ent?.status ?? null,
  });
  return true;
}
