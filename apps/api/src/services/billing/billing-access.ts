/**
 * [BILLING-DUNNING · D3/D5 · ruling 4] The single source of truth for what a failed-payment state lets
 * through. Derived from the AI gate call sites (what actually calls a model), NOT from requireEntitled.
 *
 *   payment_failed → the AI (model-calling) paths are paused; EVERYTHING else works (viewing, editing,
 *                    export, Book Scan, Monday digest, hero read-outs).
 *   suspended / ended → only the payment page, the data export, and sign-in/out. Export works in EVERY state.
 *
 * Both the HTTP chokepoint (server dispatch) and the async sweep consult this: `aiPausedForState` is the
 * predicate the sweep's canSpend uses so queued extraction/transcription waits while paused and resumes
 * the moment payment succeeds (D3, same mechanism as the exhausted allowance).
 */
import type { BillingState } from '../../ports/billing.js';

/** The AI (model-calling) request paths — the D3 list, re-derived from model call sites (ruling 3/4).
 *  Book Scan, Monday digest and the hero read-outs are NOT here: they make no model call. */
const AI_PATHS: ReadonlyArray<{ method: string; re: RegExp; feature: string }> = [
  { method: 'POST', re: /^\/clients\/[^/]+\/notes\/import$/, feature: 'importing chats' },
  { method: 'POST', re: /^\/import\/bulk$/, feature: 'importing chats (bulk)' },
  { method: 'POST', re: /^\/notes\/[^/]+\/extract$/, feature: 'extracting a note' },
  { method: 'POST', re: /^\/notes\/[^/]+\/transcribe$/, feature: 'transcribing voice notes' },
  { method: 'POST', re: /^\/recall$/, feature: 'answering questions about your clients' },
  { method: 'GET', re: /^\/clients\/[^/]+\/brief$/, feature: 'pre-meeting briefs' },
  { method: 'POST', re: /^\/notes\/[^/]+\/follow-up$/, feature: 'drafting follow-ups' },
  { method: 'GET', re: /^\/today$/, feature: 'the daily list and priorities' },
  { method: 'POST', re: /^\/today\/refresh$/, feature: 'the daily list and priorities' },
  { method: 'GET', re: /^\/inventory\/matches$/, feature: 'smart search' },
];

/** What a suspended/ended rep may still reach: the payment page, the data export, and auth. Export is
 *  allowed in EVERY state (D5) — a paywall in front of a rep's own data is a legal problem. */
function isSuspensionAllowed(method: string, path: string): boolean {
  if (path === '/account/export' && method === 'GET') return true;        // data export — always
  if (path.startsWith('/billing/')) return true;                          // payment page / status / webhook
  if (path.startsWith('/auth/')) return true;                             // sign in / out
  if (path === '/health') return true;
  return false;
}

export function isAiPath(method: string, path: string): boolean {
  return AI_PATHS.some((p) => p.method === method && p.re.test(path));
}

/**
 * [D3] The human-facing list of AI features paused during payment_failed/suspended — the SINGLE source
 * used verbatim in the failed-payment emails, the in-app banner and the Terms. Derived (ruling 3/4) from
 * the model-calling AI_PATHS above, curated to plain product names (Book Scan is NOT here — it is
 * model-free; "client pointers" is produced inside the extraction path). Keep consistent with AI_PATHS.
 */
export const PAUSED_FEATURES: readonly string[] = [
  'importing chats',
  'transcribing voice notes',
  'answering questions about your clients',
  'pre-meeting briefs',
  'client pointers',
  'the daily list and priorities',
  'drafting follow-ups',
  'smart search',
];
/** The paused features as one sentence fragment for an email/banner/Terms sentence. */
export function pausedFeaturesSentence(): string {
  return PAUSED_FEATURES.join(', ');
}

export type BillingDecision = 'allow' | 'ai_paused' | 'blocked_suspended';

/** The gate decision for one request given the account's billing state. */
export function billingGateDecision(state: BillingState, method: string, path: string): BillingDecision {
  if (state === 'active') return 'allow';
  if (state === 'payment_failed') return isAiPath(method, path) ? 'ai_paused' : 'allow';
  // suspended | ended
  return isSuspensionAllowed(method, path) ? 'allow' : 'blocked_suspended';
}

/** True when the account's billing state pauses AI work — consulted by the async sweep's canSpend so
 *  queued extraction/transcription/pointers wait while paused and resume on the next successful payment. */
export function aiPausedForState(state: BillingState): boolean {
  return state !== 'active';
}

/**
 * [P14-1] The single "may this account spend on a model call right now?" predicate. ENTITLEMENT is the
 * gate; billing STATE is the pause. Both must be satisfied:
 *   - entitled — a never-subscribed (no subscription row → status 'none'), lapsed-trial, suspended or
 *     ended account is NOT entitled and must not run AI.
 *   - not AI-paused — payment_failed is still entitled but its AI is paused (card update needed).
 *
 * This closes P14-1's leak: entitlement()'s no-row/expired default sets billingState to 'active', so a
 * billingState-only gate (`!aiPausedForState(billingState)`) returned true for an account that had never
 * paid and had no trial — free AI forever. The async sweep's canSpend and the UI lock both use this, so
 * the server-side gate and what the app shows can never drift.
 */
export function canRunAi(ent: { entitled: boolean; billingState: BillingState }): boolean {
  return ent.entitled && !aiPausedForState(ent.billingState);
}

/** [IMP-17] Why a pending note can't be extracted right now from the account's entitlement STATUS, or
 *  null when billing isn't the blocker — a failed/suspended payment needs a card update; a lapsed trial
 *  or ended/cancelled subscription needs a new subscription. Kept in the billing module (the single home
 *  for lifecycle-state literals) so no route hand-codes them (billing-state-guard). */
export function extractionBillingBlock(status: string): 'subscribe' | 'payment' | null {
  if (status === 'payment_failed' || status === 'suspended') return 'payment';
  if (status === 'ended' || status === 'trial_expired' || status === 'none' || status === 'canceled' || status === 'past_due') return 'subscribe';
  return null;
}

/** The HTTP body + status for a gate refusal — centralised here so no caller hand-codes a billing-state
 *  branch. `hostedInvoiceUrl` is the Stripe hosted page where the rep pays + completes 3DS (ruling 2). */
export function blockedBody(decision: 'ai_paused' | 'blocked_suspended', state: BillingState, hostedInvoiceUrl: string | null): { status: number; body: Record<string, unknown> } {
  if (decision === 'ai_paused') {
    return { status: 402, body: { error: 'ai_paused', message: 'AI features are paused because your last payment failed. Update your payment details to resume.', hostedInvoiceUrl } };
  }
  const ended = state === 'ended';
  return {
    status: 403,
    body: {
      error: ended ? 'subscription_ended' : 'account_suspended',
      message: ended
        ? 'Your subscription has ended. Contact hello@tovira.io to restore your account.'
        : 'Your account is suspended after a failed payment. Update your payment details to restore access. You can still export your data.',
      hostedInvoiceUrl,
    },
  };
}
