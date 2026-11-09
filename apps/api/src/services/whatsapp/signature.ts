import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * [P67] Meta signs every webhook POST: `X-Hub-Signature-256: sha256=<hex>`, an HMAC-SHA256 of the RAW body with the
 * app secret. Compared in constant time; anything missing or malformed fails.
 */
export function validHubSignature(rawBody: Uint8Array, header: string | string[] | undefined, appSecret: string): boolean {
  const h = Array.isArray(header) ? header[0] : header;
  if (!h || !h.startsWith('sha256=') || !appSecret) return false;
  const got = Buffer.from(h.slice('sha256='.length), 'hex');
  const want = createHmac('sha256', appSecret).update(rawBody).digest();
  return got.length === want.length && timingSafeEqual(got, want);
}

/** The GET subscribe handshake: hub.mode=subscribe and the verify token we set in the App Dashboard. */
export function verifyHandshake(params: URLSearchParams, verifyToken: string): string | null {
  if (params.get('hub.mode') !== 'subscribe' || !verifyToken) return null;
  const given = Buffer.from(params.get('hub.verify_token') ?? '');
  const want = Buffer.from(verifyToken);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return null;
  return params.get('hub.challenge');
}
