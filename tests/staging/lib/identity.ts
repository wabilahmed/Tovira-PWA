/**
 * Identity factory + teardown registry (rail #3 — own your data, tear it all down).
 * Every account is a fresh, uniquely-namespaced QA identity; `newRep()` signs one up
 * and returns an authenticated session (its own HttpClient with the session cookie in
 * its jar). The factory tracks everything it creates so `teardownAll()` can delete it,
 * even when a test failed.
 */
import { HttpClient } from './http.js';
import { newRunId, qaEmailDomain, type Target } from './env.js';

export interface Identity {
  email: string;
  password: string;
  userId: string;
  token: string;
  http: HttpClient; // authenticated (session cookie held in its jar)
}

interface SignupResult {
  user?: { id?: string; email?: string };
  token?: string;
}

export interface NewRepOptions {
  ref?: string; // a referral code to attach at signup
  consent?: boolean; // default true; pass false to exercise the consent guard
  emailOverride?: string; // exact email (for duplicate/enumeration probes)
  passwordOverride?: string;
}

export class IdentityFactory {
  readonly runId = newRunId();
  private seq = 0;
  private readonly created: Identity[] = [];

  constructor(private readonly target: Target) {}

  /** A unique namespaced email that is provably ours and not a real inbox. */
  email(n = ++this.seq): string {
    return `qa+${this.runId}-${n}@${qaEmailDomain()}`;
  }

  strongPassword(): string {
    return `Qa1!${this.runId}-${Math.random().toString(36).slice(2, 8)}Zx`;
  }

  /** Sign up a fresh rep and return an authenticated Identity. Throws on non-201. */
  async newRep(opts: NewRepOptions = {}): Promise<Identity> {
    const email = opts.emailOverride ?? this.email();
    const password = opts.passwordOverride ?? this.strongPassword();
    const http = new HttpClient(this.target);
    const res = await http.post<SignupResult>('/auth/signup', {
      email,
      password,
      consent: opts.consent ?? true,
      ...(opts.ref ? { ref: opts.ref } : {}),
    });
    if (res.status !== 201 || !res.body?.user?.id || !res.body.token) {
      throw new Error(`newRep signup failed for ${email}: ${http.lastExchange()}`);
    }
    const identity: Identity = { email, password, userId: res.body.user.id, token: res.body.token, http };
    this.created.push(identity);
    return identity;
  }

  /**
   * Adopt an account we created out-of-band (e.g. via a raw signup that returned a
   * non-201 but still created the row) so teardown will clean it up. Logs in to get a
   * session; returns null if it can't (nothing to adopt). Rail #3 — never leak accounts.
   */
  async adopt(email: string, password: string): Promise<Identity | null> {
    const http = new HttpClient(this.target);
    const res = await http.post<SignupResult>('/auth/login', { email, password });
    if (res.status !== 200 || !res.body?.token) return null;
    const identity: Identity = { email, password, userId: res.body.user?.id ?? '', token: res.body.token, http };
    this.created.push(identity);
    return identity;
  }

  /** Everything this factory created, for assertions/reporting. */
  all(): readonly Identity[] {
    return this.created;
  }

  /** Best-effort delete of every account created (rail #3). Never throws. */
  async teardownAll(): Promise<{ deleted: number; failed: number }> {
    let deleted = 0;
    let failed = 0;
    for (const id of this.created) {
      try {
        const res = await id.http.del('/account');
        // 200 = deleted now; 401/404 = already gone (e.g. a test deleted it) — both fine.
        if (res.status === 200 || res.status === 401 || res.status === 404) deleted++;
        else failed++;
      } catch {
        failed++;
      }
    }
    return { deleted, failed };
  }
}
