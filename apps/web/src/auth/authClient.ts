export interface Session {
  user: { id: string; email: string; referralCode: string };
}

/**
 * Client half of the session. Talks to the API with `credentials: 'include'` so
 * the HttpOnly session cookie rides along, and treats a 401 from /me as
 * "logged out" (the UI then shows the login screen).
 */
export class AuthClient {
  constructor(private readonly baseUrl: string = '') {}

  private url(path: string): string {
    return `${this.baseUrl}${path}`;
  }

  async signup(email: string, password: string, ref?: string, consent?: boolean): Promise<Session> {
    return this.authPost('/auth/signup', email, password, ref, consent);
  }

  async login(email: string, password: string): Promise<Session> {
    return this.authPost('/auth/login', email, password);
  }

  async logout(): Promise<void> {
    await fetch(this.url('/auth/logout'), { method: 'POST', credentials: 'include' });
  }

  /** Request a reset link. Resolves either way — the UI never reveals whether
   *  the email has an account (no enumeration). */
  async forgotPassword(email: string): Promise<void> {
    try {
      await fetch(this.url('/auth/forgot-password'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      });
    } catch {
      /* ignore — the confirmation copy is identical regardless */
    }
  }

  async resetPassword(token: string, password: string): Promise<{ ok: boolean; message?: string }> {
    try {
      const res = await fetch(this.url('/auth/reset-password'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      if (res.ok) return { ok: true };
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      return { ok: false, message: body.message ?? 'Could not reset your password.' };
    } catch {
      return { ok: false, message: 'Network error — please try again.' };
    }
  }

  async getSession(): Promise<Session | null> {
    try {
      const res = await fetch(this.url('/me'), { credentials: 'include' });
      if (res.status !== 200) return null;
      const data = (await res.json()) as Session;
      return { user: data.user };
    } catch {
      // Offline / network error → treat as not-authenticated so the shell still
      // renders (the PWA works offline; sign-in just needs a connection).
      return null;
    }
  }

  private async authPost(path: string, email: string, password: string, ref?: string, consent?: boolean): Promise<Session> {
    const body: Record<string, unknown> = { email, password };
    if (ref) body.ref = ref;
    if (consent !== undefined) body.consent = consent;
    const res = await fetch(this.url(path), {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      throw new Error(body.message ?? 'Authentication failed.');
    }
    const data = (await res.json()) as Session;
    return { user: data.user };
  }
}
