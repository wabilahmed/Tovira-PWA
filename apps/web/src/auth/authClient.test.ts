import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AuthClient } from './authClient.js';

// [P0-3] Client half of the session: the app asks the server who it is, and
// treats a 401 as "logged out" (so the UI shows the login screen).
describe('AuthClient', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  function jsonResponse(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }

  it('logs in and returns the session, sending cookies', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { user: { id: 'u1', email: 'a@example.com' }, token: 't' }),
    );
    const client = new AuthClient('http://api.test');
    const session = await client.login('a@example.com', 'password123');
    expect(session.user.email).toBe('a@example.com');
    const [, init] = fetchMock.mock.calls[0]!;
    expect((init as RequestInit).credentials).toBe('include');
    expect((init as RequestInit).method).toBe('POST');
  });

  it('getSession returns the current user when the server says 200', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { user: { id: 'u1', email: 'a@example.com' } }));
    const client = new AuthClient('http://api.test');
    const session = await client.getSession();
    expect(session?.user.email).toBe('a@example.com');
  });

  // NEGATIVE: an unauthenticated check must resolve to null, not throw — the UI
  // uses null to redirect to login.
  it('getSession returns null on 401 (not authenticated)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: 'unauthorized' }));
    const client = new AuthClient('http://api.test');
    expect(await client.getSession()).toBeNull();
  });

  it('logout posts to the logout endpoint with credentials', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    const client = new AuthClient('http://api.test');
    await client.logout();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain('/auth/logout');
    expect((init as RequestInit).credentials).toBe('include');
  });

  it('surfaces a failed signup as an error (duplicate email)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(409, { error: 'email_in_use', message: 'That email is already registered.' }));
    const client = new AuthClient('http://api.test');
    await expect(client.signup('dup@example.com', 'password123')).rejects.toThrow(/already registered/i);
  });

  // [EMAIL-VERIFY] confirming an email via the token in the link.
  it('verifyEmail resolves ok on 200 and posts the token with credentials', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    const client = new AuthClient('http://api.test');
    expect(await client.verifyEmail('tok')).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain('/auth/verify-email');
    expect((init as RequestInit).credentials).toBe('include');
    expect((init as RequestInit).body).toBe(JSON.stringify({ token: 'tok' }));
  });

  it('verifyEmail resolves {ok:false} with the message on a bad token (never throws)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(400, { message: 'This verification link is invalid or has expired. Request a new one.' }));
    const client = new AuthClient('http://api.test');
    const r = await client.verifyEmail('bad');
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/invalid or has expired/i);
  });

  it('resendVerification flags a 429 as rateLimited (server-enforced)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(429, { message: 'too many' }));
    const client = new AuthClient('http://api.test');
    const r = await client.resendVerification();
    expect(r).toMatchObject({ ok: false, rateLimited: true });
  });

  it('resendVerification resolves ok on 200', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    const client = new AuthClient('http://api.test');
    expect(await client.resendVerification()).toEqual({ ok: true });
  });

  // POSITIVE: a successful signup returns the new session and POSTs to /auth/signup.
  it('signs up and returns the session, sending cookies', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { user: { id: 'u9', email: 'new@example.com' } }));
    const client = new AuthClient('http://api.test');
    const session = await client.signup('new@example.com', 'password123');
    expect(session.user.email).toBe('new@example.com');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('http://api.test/auth/signup');
    expect((init as RequestInit).method).toBe('POST');
    expect((init as RequestInit).credentials).toBe('include');
    // Signup carries email + password and (NUDGE-TZ) the browser's IANA zone for nudge timing.
    const body = JSON.parse((init as RequestInit).body as string) as { email: string; password: string; timezone?: string };
    expect(body.email).toBe('new@example.com');
    expect(body.password).toBe('password123');
    expect(typeof body.timezone).toBe('string');
    expect(body.timezone!.length).toBeGreaterThan(0);
  });
});
