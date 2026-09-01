/**
 * Forge Stripe TEST-MODE webhook events with a valid signature, the way Stripe's own
 * library verifies them: HMAC-SHA256 over `${timestamp}.${payload}` keyed by the raw
 * signing secret (the whole whsec_… string), sent as `Stripe-Signature: t=…,v1=…`.
 *
 * The secret is read from STAGING_STRIPE_WEBHOOK_SECRET at call time and is NEVER
 * written to a file, committed, or logged. Absent → the A5 signed-webhook tests skip
 * and are recorded UNREACHABLE.
 */
import { createHmac, randomBytes } from 'node:crypto';

export function stripeWebhookSecret(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const s = env.STAGING_STRIPE_WEBHOOK_SECRET?.trim();
  return s && s.startsWith('whsec_') ? s : undefined;
}

export interface SignedEvent {
  payload: string;
  signatureHeader: string;
  eventId: string;
}

/**
 * Build a signed event. Reuse `eventId` to exercise idempotent replay. `object` is the
 * `data.object` — pass client_reference_id / customer / subscription / current_period_end
 * as the handler expects.
 */
export function signEvent(
  secret: string,
  type: string,
  object: Record<string, unknown>,
  eventId = `evt_test_${Date.now()}_${randomBytes(6).toString('hex')}`,
): SignedEvent {
  const event = { id: eventId, object: 'event', type, data: { object } };
  const payload = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac('sha256', secret).update(`${t}.${payload}`, 'utf8').digest('hex');
  return { payload, signatureHeader: `t=${t},v1=${v1}`, eventId };
}
