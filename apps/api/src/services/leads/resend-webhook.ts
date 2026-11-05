import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * [P63-9 · owner] Resend's delivery webhooks, for the invite email's status on each lead card: delivered, bounced or
 * marked spam. Opens and clicks are never recorded. Resend signs each webhook (Svix): HMAC-SHA256 over
 * "<svix-id>.<svix-timestamp>.<body>" with the webhook's signing secret ("whsec_" + base64). Without the secret the
 * webhook is refused and nothing is recorded (shipped dark until RESEND_WEBHOOK_SECRET is added).
 */
export type DeliveryStatus = 'delivered' | 'bounced' | 'complained';

/** The event types we record; everything else (sent, opened, clicked, delivery_delayed …) is ignored. */
export function deliveryStatusOf(type: unknown): DeliveryStatus | null {
  return type === 'email.delivered' ? 'delivered' : type === 'email.bounced' ? 'bounced' : type === 'email.complained' ? 'complained' : null;
}

/** A bounce or a spam mark is never replaced by a later "delivered"; a spam mark beats a bounce. */
export function nextDelivery(current: DeliveryStatus | null, incoming: DeliveryStatus): DeliveryStatus {
  const rank: Record<DeliveryStatus, number> = { delivered: 0, bounced: 1, complained: 2 };
  return current && rank[current] >= rank[incoming] ? current : incoming;
}

const TOLERANCE_S = 5 * 60;

/** Verify a Svix signature. Returns false for any missing header, an old or future timestamp, or a mismatch. */
export function verifySvix(secret: string, headers: { id?: string; timestamp?: string; signature?: string }, body: string, nowMs: number): boolean {
  if (!secret || !headers.id || !headers.timestamp || !headers.signature) return false;
  const ts = Number(headers.timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowMs / 1000 - ts) > TOLERANCE_S) return false;
  const key = Buffer.from(secret.startsWith('whsec_') ? secret.slice(6) : secret, 'base64');
  const expected = createHmac('sha256', key).update(`${headers.id}.${headers.timestamp}.${body}`).digest();
  for (const part of headers.signature.split(' ')) {
    const [v, sig] = part.split(',');
    if (v !== 'v1' || !sig) continue;
    const got = Buffer.from(sig, 'base64');
    if (got.length === expected.length && timingSafeEqual(got, expected)) return true;
  }
  return false;
}

/** The lead an event is about: the "lead" tag the invite email was sent with (object or array form). */
export function leadTagOf(data: unknown): string | null {
  const tags = (data as { tags?: unknown } | null)?.tags;
  if (Array.isArray(tags)) { const t = tags.find((x) => (x as { name?: unknown })?.name === 'lead') as { value?: unknown } | undefined; return typeof t?.value === 'string' ? t.value : null; }
  if (tags && typeof tags === 'object') { const v = (tags as Record<string, unknown>).lead; return typeof v === 'string' ? v : null; }
  return null;
}
