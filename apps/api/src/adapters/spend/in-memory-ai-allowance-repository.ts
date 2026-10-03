import { randomUUID } from 'node:crypto';
import type {
  AiAllowanceRepository,
  AiMonth,
  GlobalSpendResult,
  ReserveResult,
} from '../../ports/ai-allowance-repository.js';

interface Reservation {
  id: string;
  userId: string;
  periodKey: string;
  estimateAed: number;
  status: 'open' | 'settled' | 'released' | 'expired';
  expiresAtMs: number;
}

/**
 * In-memory AI-allowance ledger (tests). Mirrors the pg contract. The reservation is an ATOMIC
 * critical section: the availability check and the `reserved` increment happen with NO `await` between
 * them, so two concurrent reserves can never both read the same headroom and both pass — exactly as a
 * single conditional UPDATE behaves in Postgres. (The concurrency guard mutates this into a
 * read-then-write and proves it over-admits.)
 */
export class InMemoryAiAllowanceRepository implements AiAllowanceRepository {
  private readonly months = new Map<string, AiMonth>();
  private readonly reservations = new Map<string, Reservation>();
  private readonly global = new Map<string, { spentAed: number; alertSent: boolean }>();

  private readonly key = (userId: string, periodKey: string) => `${userId}\u0000${periodKey}`;

  async ensureMonth(userId: string, periodKey: string, periodStartMs: number, allowanceAed: number): Promise<AiMonth> {
    const k = this.key(userId, periodKey);
    const existing = this.months.get(k);
    if (existing) return { ...existing };
    // Carry forward the previous window's REMAINING top-up (D7/D8).
    const prev = [...this.months.values()]
      .filter((m) => m.userId === userId && m.periodStartMs < periodStartMs)
      .sort((a, b) => b.periodStartMs - a.periodStartMs)[0];
    const carriedTopup = prev ? Math.max(0, prev.topupAed - Math.max(0, prev.spentAed - prev.allowanceAed)) : 0;
    const row: AiMonth = { userId, periodKey, periodStartMs, allowanceAed, topupAed: carriedTopup, spentAed: 0, reservedAed: 0, displayExhausted: false };
    this.months.set(k, row);
    return { ...row };
  }

  async reserve(userId: string, periodKey: string, estimateAed: number, expiresAtMs: number): Promise<ReserveResult> {
    const row = this.months.get(this.key(userId, periodKey));
    if (!row) return { ok: false };
    // ATOMIC: no await between the check and the write.
    const available = row.allowanceAed + row.topupAed;
    if (row.spentAed + row.reservedAed + estimateAed > available) {
      row.displayExhausted = true; // [sticky] a refusal pins the meter to 100% until allowance is added
      return { ok: false };
    }
    row.reservedAed += estimateAed;
    const id = randomUUID();
    this.reservations.set(id, { id, userId, periodKey, estimateAed, status: 'open', expiresAtMs });
    return { ok: true, reservationId: id };
  }

  async settle(userId: string, reservationId: string, actualAed: number): Promise<void> {
    const r = this.reservations.get(reservationId);
    if (!r || r.userId !== userId || r.status !== 'open') return;
    const row = this.months.get(this.key(userId, r.periodKey));
    if (row) {
      row.reservedAed = Math.max(0, row.reservedAed - r.estimateAed);
      row.spentAed += Math.max(0, actualAed);
    }
    r.status = 'settled';
  }

  async release(userId: string, reservationId: string): Promise<void> {
    const r = this.reservations.get(reservationId);
    if (!r || r.userId !== userId || r.status !== 'open') return;
    const row = this.months.get(this.key(userId, r.periodKey));
    if (row) row.reservedAed = Math.max(0, row.reservedAed - r.estimateAed);
    r.status = 'released';
  }

  async expireStale(nowMs: number): Promise<number> {
    let n = 0;
    for (const r of this.reservations.values()) {
      if (r.status !== 'open' || r.expiresAtMs > nowMs) continue;
      const row = this.months.get(this.key(r.userId, r.periodKey));
      if (row) row.reservedAed = Math.max(0, row.reservedAed - r.estimateAed);
      r.status = 'expired';
      n += 1;
    }
    return n;
  }

  async topUp(userId: string, periodKey: string, addedAed: number): Promise<void> {
    const row = this.months.get(this.key(userId, periodKey));
    if (row) {
      row.topupAed += Math.max(0, addedAed);
      row.displayExhausted = false; // allowance added → clear the sticky stop (D8)
    }
  }

  // [FIX 5] Events already credited. The CREDIT runs first and the id is recorded only AFTER it
  // succeeds, mirroring the pg "insert-gated, same transaction, rollback-on-failure" contract: a failed
  // credit leaves the event un-recorded (retryable), and a replay after success is a no-op.
  private readonly creditedEvents = new Set<string>();

  async creditTopUpOnce(eventId: string, userId: string, periodKey: string, periodStartMs: number, allowanceAed: number, addedAed: number): Promise<boolean> {
    if (this.creditedEvents.has(eventId)) return false; // idempotent replay
    await this.ensureMonth(userId, periodKey, periodStartMs, allowanceAed);
    await this.topUp(userId, periodKey, addedAed); // if this throws, the id is NOT recorded → retryable
    this.creditedEvents.add(eventId);
    return true;
  }

  async getMonth(userId: string, periodKey: string): Promise<AiMonth | null> {
    const row = this.months.get(this.key(userId, periodKey));
    return row ? { ...row } : null;
  }

  async recordGlobal(ym: string, aed: number, alertThresholdAed: number): Promise<GlobalSpendResult> {
    const g = this.global.get(ym) ?? { spentAed: 0, alertSent: false };
    const before = g.spentAed;
    g.spentAed += Math.max(0, aed);
    const crossed = !g.alertSent && before < alertThresholdAed && g.spentAed >= alertThresholdAed;
    if (crossed) g.alertSent = true;
    this.global.set(ym, g);
    return { totalAed: g.spentAed, crossedAlert: crossed };
  }
}
