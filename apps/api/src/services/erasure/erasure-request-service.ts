import type { ErasureService } from './erasure-service.js';
import type { ErasureRequestRepository, ErasureRequestRecord } from '../../ports/erasure-request-repository.js';
import type { NotificationRepository } from '../../ports/notification-repository.js';
import type { PushableAlert } from '../push/push-dispatch-service.js';

/**
 * [ERASURE Task 4] The rep-facing side of a single-counterparty erasure (Terms 4.9). A third party's
 * erasure is a legal request the rep CANNOT decline — but before it completes the rep has a window to
 * assert a legal basis for RETENTION. This service opens the request, tells the rep (never silently),
 * holds the window, and completes the erasure after it — telling the rep what was removed, in
 * categories.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Default retention-assertion window. DERIVATION: matches the drafted Terms clause 4.9 (14 days).
 *  NOT SETTLED — the Terms wording is still in draft; wire it configurable and revisit on sign-off. */
export const DEFAULT_ERASURE_WINDOW_DAYS = 14;

export interface ErasureRequestDeps {
  erasure: ErasureService;
  requests: ErasureRequestRepository;
  notifications: NotificationRepository;
  /** Push through the shared dispatcher (erasure notices are time-critical → they push). */
  dispatch: (userId: string, alerts: PushableAlert[]) => Promise<unknown>;
  now?: () => number;
  windowDays?: number;
}

export class ErasureRequestService {
  constructor(private readonly deps: ErasureRequestDeps) {}
  private now(): number { return (this.deps.now ?? Date.now)(); }
  private windowDays(): number { return this.deps.windowDays ?? DEFAULT_ERASURE_WINDOW_DAYS; }

  /** Open a request: preview the impact, record the pending request + window, and notify the rep. */
  async open(userId: string, requesterNames: string[]): Promise<ErasureRequestRecord> {
    const now = this.now();
    const windowEndsAt = now + this.windowDays() * DAY_MS;
    const plan = await this.deps.erasure.preview(userId, requesterNames);
    const cats = [
      ...plan.autoDelete.map((i) => i.store),
      ...(plan.logRowIds.length ? ['training_logs'] : []),
    ];
    const summary = summariseCategories(cats);
    const req = await this.deps.requests.create(userId, { requesterNames, requestedAt: now, windowEndsAt });
    const until = new Date(windowEndsAt).toISOString().slice(0, 10);
    await this.notify(userId, {
      type: 'erasure_pending',
      dedupeKey: `erasure_pending:${req.id}`,
      clientId: null,
      title: 'A data-erasure request has been received',
      body: `A third party asked us to erase their data from your account — a legal request you cannot decline. ${summary ? `To be removed: ${summary}. ` : ''}You have until ${until} to tell us if you have a legal basis to retain it.`,
    });
    return req;
  }

  /** The rep asserts a legal basis for retention → halts auto-completion pending review. */
  async assertRetention(userId: string, requestId: string): Promise<boolean> {
    const req = await this.deps.requests.get(userId, requestId);
    if (!req || req.status !== 'pending') return false;
    return this.deps.requests.setStatus(userId, requestId, 'retention_asserted');
  }

  /**
   * Complete the erasure. Refuses BEFORE the window closes and if the rep asserted retention (a legal
   * hold). On success, runs the erasure and tells the rep what was removed.
   */
  async complete(userId: string, requestId: string): Promise<{ ok: boolean; reason?: string }> {
    const req = await this.deps.requests.get(userId, requestId);
    if (!req) return { ok: false, reason: 'not_found' };
    if (req.status === 'completed') return { ok: false, reason: 'already_completed' };
    if (req.status === 'retention_asserted') return { ok: false, reason: 'retention_asserted' };
    if (this.now() < req.windowEndsAt) return { ok: false, reason: 'window_open' };

    // [ERASURE-ARCHIVE Task 4] THE GATE: the erasure is only complete if commit fully succeeded —
    // and commit purges the training archive first, throwing if the object store is unreachable
    // (down / credentials missing). On any failure we do NOT mark the request complete and do NOT
    // notify the rep of completion: it stays OPEN and the error surfaces, never a silent gap.
    let result: Awaited<ReturnType<ErasureService['commit']>>;
    try {
      result = await this.deps.erasure.commit(userId, req.requesterNames);
    } catch (err) {
      return { ok: false, reason: `incomplete: ${err instanceof Error ? err.message : 'erasure failed'}` };
    }
    await this.deps.requests.setStatus(userId, requestId, 'completed');
    const summary = summariseCategories(result.categories.map((c) => `${c.category}:${c.deleted}`));
    await this.notify(userId, {
      type: 'erasure_completed',
      dedupeKey: `erasure_completed:${req.id}`,
      clientId: null,
      title: 'A data-erasure request has been completed',
      body: `We erased a third party's data from your account as legally required.${summary ? ` Removed — ${summary}.` : ''}`,
    });
    return { ok: true };
  }

  private async notify(userId: string, alert: PushableAlert): Promise<void> {
    // Record in-app (never silent) then push (erasure notices are time-critical).
    await this.deps.notifications.createIfAbsent(userId, { type: alert.type, dedupeKey: alert.dedupeKey, clientId: alert.clientId, title: alert.title, body: alert.body });
    await this.deps.dispatch(userId, [alert]);
  }
}

/** Category names → a short human list, e.g. "people (2), messages (1)". No content. */
function summariseCategories(cats: string[]): string {
  const counts = new Map<string, number>();
  for (const c of cats) {
    const [name, n] = c.includes(':') ? [c.split(':')[0]!, Number(c.split(':')[1])] : [c, 1];
    counts.set(name, (counts.get(name) ?? 0) + (Number.isFinite(n) ? n : 1));
  }
  return [...counts.entries()].map(([name, n]) => `${name.replace(/_/g, ' ')} (${n})`).join(', ');
}
