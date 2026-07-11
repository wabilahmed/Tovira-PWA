export interface Session {
  user: { id: string; email: string };
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

  async signup(email: string, password: string): Promise<Session> {
    return this.authPost('/auth/signup', email, password);
  }

  async login(email: string, password: string): Promise<Session> {
    return this.authPost('/auth/login', email, password);
  }

  async logout(): Promise<void> {
    await fetch(this.url('/auth/logout'), { method: 'POST', credentials: 'include' });
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

  private async authPost(path: string, email: string, password: string): Promise<Session> {
    const res = await fetch(this.url(path), {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      throw new Error(body.message ?? 'Authentication failed.');
    }
    const data = (await res.json()) as Session;
    return { user: data.user };
  }
}
