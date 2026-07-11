import type { IncomingMessage, ServerResponse } from 'node:http';

export function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(payload);
}

export class BadJsonError extends Error {}

/** Read and JSON-parse a request body. Empty body → {}. Invalid JSON → BadJsonError. */
export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  const LIMIT = 1_000_000; // 1 MB guard
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > LIMIT) throw new BadJsonError('body too large');
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new BadJsonError('invalid JSON');
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const val = part.slice(eq + 1).trim();
    if (key) out[key] = decodeURIComponent(val);
  }
  return out;
}

/** Extract the session token from `Authorization: Bearer` or the session cookie. */
export function extractToken(req: IncomingMessage): string {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) return auth.slice('Bearer '.length).trim();
  const cookies = parseCookies(req.headers.cookie);
  return cookies.session ?? '';
}

export function sessionCookie(token: string, maxAgeSeconds: number, secure: boolean): string {
  const attrs = ['Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSeconds}`];
  if (secure) attrs.push('Secure');
  return `session=${token}; ${attrs.join('; ')}`;
}

export function clearedSessionCookie(secure: boolean): string {
  const attrs = ['Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (secure) attrs.push('Secure');
  return `session=; ${attrs.join('; ')}`;
}
