/**
 * A small in-process rate limiter for the auth endpoints — the defence against
 * online password guessing. Fixed window per key (e.g. per IP+email): after
 * `max` failures inside `windowMs`, `check` reports the key blocked until the
 * window rolls over. `record` counts a failure; `clear` resets on success.
 *
 * In-process is sufficient for the single API task the infra runs today; swap for
 * a shared (DB/Redis) store when the service scales horizontally. Never throws.
 */
export interface RateLimiter {
  /** Is this key currently blocked? Read-only. */
  check(key: string, nowMs?: number): { limited: boolean; retryAfterSec: number };
  /** Count one failed attempt against the key. */
  record(key: string, nowMs?: number): void;
  /** Reset the key (e.g. after a successful login). */
  clear(key: string): void;
}

export class FixedWindowRateLimiter implements RateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  check(key: string, nowMs: number = Date.now()): { limited: boolean; retryAfterSec: number } {
    const w = this.windows.get(key);
    if (!w || nowMs >= w.resetAt) return { limited: false, retryAfterSec: 0 };
    const limited = w.count >= this.max;
    return { limited, retryAfterSec: limited ? Math.ceil((w.resetAt - nowMs) / 1000) : 0 };
  }

  record(key: string, nowMs: number = Date.now()): void {
    const w = this.windows.get(key);
    if (!w || nowMs >= w.resetAt) {
      this.windows.set(key, { count: 1, resetAt: nowMs + this.windowMs });
      return;
    }
    w.count += 1;
  }

  clear(key: string): void {
    this.windows.delete(key);
  }
}
