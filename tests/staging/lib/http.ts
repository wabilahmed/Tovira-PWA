/**
 * A thin HTTP client with a per-identity cookie jar, JSON helpers, timing capture,
 * and full request/response capture for failures. One instance per identity (so
 * sessions never bleed across accounts); an anonymous instance is used for signup,
 * login, and unauthenticated probes.
 */
import { resolveTarget, type Target } from './env.js';

export interface HttpResponse<T = unknown> {
  status: number;
  ok: boolean;
  body: T;
  rawText: string;
  headers: Headers;
  durationMs: number;
}

export interface CapturedExchange {
  method: string;
  url: string;
  reqBody: unknown;
  status: number;
  resBody: unknown;
  durationMs: number;
}

export interface RequestOptions {
  headers?: Record<string, string>;
  /** Send no body even for POST (default: JSON-encode `body` when present). */
  raw?: string;
  rawContentType?: string;
}

function parseSetCookies(res: Response): string[] {
  // Node 20's undici exposes getSetCookie(); fall back to a single header.
  const anyHeaders = res.headers as unknown as { getSetCookie?: () => string[] };
  if (typeof anyHeaders.getSetCookie === 'function') return anyHeaders.getSetCookie();
  const single = res.headers.get('set-cookie');
  return single ? [single] : [];
}

export class HttpClient {
  readonly target: Target;
  private readonly jar = new Map<string, string>();
  /** The last N exchanges, kept so a failing assertion can print what happened. */
  readonly history: CapturedExchange[] = [];

  constructor(target?: Target) {
    this.target = target ?? resolveTarget();
  }

  /** The `session` cookie value currently held, if any (for assertions). */
  sessionCookie(): string | undefined {
    return this.jar.get('session');
  }

  private cookieHeader(): string | undefined {
    if (this.jar.size === 0) return undefined;
    return [...this.jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  private absorbCookies(res: Response): void {
    for (const raw of parseSetCookies(res)) {
      const pair = raw.split(';')[0];
      if (!pair) continue;
      const eq = pair.indexOf('=');
      if (eq <= 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      // A cleared cookie (logout) removes it from the jar.
      if (value === '' || /Max-Age=0/i.test(raw) || /Expires=Thu, 01 Jan 1970/i.test(raw)) {
        this.jar.delete(name);
      } else {
        this.jar.set(name, value);
      }
    }
  }

  async request<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
    opts: RequestOptions = {},
  ): Promise<HttpResponse<T>> {
    const url = path.startsWith('http') ? path : `${this.target.apiBase}${path.startsWith('/') ? '' : '/'}${path}`;
    const headers: Record<string, string> = { accept: 'application/json', ...opts.headers };
    const cookie = this.cookieHeader();
    if (cookie) headers.cookie = cookie;

    let payload: string | undefined;
    if (opts.raw !== undefined) {
      payload = opts.raw;
      headers['content-type'] = opts.rawContentType ?? 'text/plain';
    } else if (body !== undefined) {
      payload = JSON.stringify(body);
      headers['content-type'] = 'application/json';
    }

    const started = performance.now();
    const res = await fetch(url, { method, headers, body: payload, redirect: 'manual' });
    const durationMs = performance.now() - started;
    this.absorbCookies(res);

    const rawText = await res.text();
    let parsed: unknown = undefined;
    if (rawText) {
      try {
        parsed = JSON.parse(rawText);
      } catch {
        parsed = rawText;
      }
    }

    this.history.push({ method, url, reqBody: body ?? opts.raw, status: res.status, resBody: parsed, durationMs });
    if (this.history.length > 50) this.history.shift();

    return { status: res.status, ok: res.ok, body: parsed as T, rawText, headers: res.headers, durationMs };
  }

  get<T = unknown>(path: string, opts?: RequestOptions) {
    return this.request<T>('GET', path, undefined, opts);
  }
  post<T = unknown>(path: string, body?: unknown, opts?: RequestOptions) {
    return this.request<T>('POST', path, body, opts);
  }
  del<T = unknown>(path: string, body?: unknown, opts?: RequestOptions) {
    return this.request<T>('DELETE', path, body, opts);
  }

  /** The most recent exchange, formatted for a failure report. */
  lastExchange(): string {
    const e = this.history[this.history.length - 1];
    if (!e) return '(no requests made)';
    return `${e.method} ${e.url} → ${e.status} (${Math.round(e.durationMs)}ms)\n  req: ${trunc(e.reqBody)}\n  res: ${trunc(e.resBody)}`;
  }
}

function trunc(v: unknown, max = 600): string {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  if (!s) return String(v);
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
