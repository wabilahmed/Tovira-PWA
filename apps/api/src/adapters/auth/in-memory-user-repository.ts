import { randomUUID } from 'node:crypto';
import type { CreateUserInput, TourRecord, UserRecord, UserRepository } from '../../ports/user-repository.js';

/** In-memory user store for tests and quick local runs. */
export class InMemoryUserRepository implements UserRepository {
  private readonly byId = new Map<string, UserRecord>();
  private readonly byEmail = new Map<string, string>();
  private readonly byCode = new Map<string, string>();
  private readonly uiPrefs = new Map<string, Record<string, unknown>>();
  private readonly tours = new Map<string, TourRecord>();

  async findByEmail(email: string): Promise<UserRecord | null> {
    const id = this.byEmail.get(email);
    return id ? (this.byId.get(id) ?? null) : null;
  }

  async findById(id: string): Promise<UserRecord | null> {
    return this.byId.get(id) ?? null;
  }

  async findByReferralCode(code: string): Promise<UserRecord | null> {
    const id = this.byCode.get(code);
    return id ? (this.byId.get(id) ?? null) : null;
  }

  async create(input: CreateUserInput): Promise<UserRecord> {
    const record: UserRecord = {
      id: randomUUID(),
      email: input.email,
      passwordHash: input.passwordHash,
      referralCode: input.referralCode,
      termsAcceptedAt: input.termsAcceptedAt ?? null,
      termsVersionAccepted: input.termsVersionAccepted ?? null,
      termsAcceptedIp: input.termsAcceptedIp ?? null,
      emailVerified: false,
      timezone: input.timezone ?? 'Asia/Dubai',
      createdAt: Date.now(),
    };
    this.byId.set(record.id, record);
    this.byEmail.set(record.email, record.id);
    this.byCode.set(record.referralCode, record.id);
    return record;
  }

  async updatePassword(id: string, passwordHash: string): Promise<void> {
    const rec = this.byId.get(id);
    if (rec) rec.passwordHash = passwordHash;
  }

  async updateTimezone(id: string, timezone: string): Promise<void> {
    const rec = this.byId.get(id);
    if (rec) rec.timezone = timezone;
  }

  async getUiPrefs(id: string): Promise<Record<string, unknown>> {
    return structuredClone(this.uiPrefs.get(id) ?? {});
  }

  async updateUiPrefs(id: string, prefs: Record<string, unknown>): Promise<void> {
    if (this.byId.has(id)) this.uiPrefs.set(id, structuredClone(prefs));
  }

  async getTour(id: string): Promise<TourRecord> {
    return { ...(this.tours.get(id) ?? { completedAt: null, completedVersion: null, step: 0, stepVersion: null, maxStep: -1 }) };
  }

  async setTourStep(id: string, version: number, step: number): Promise<{ previousMax: number }> {
    const t = await this.getTour(id);
    const previousMax = t.stepVersion === version ? t.maxStep : -1;
    this.tours.set(id, { ...t, step, stepVersion: version, maxStep: Math.max(previousMax, step) });
    return { previousMax };
  }

  async completeTour(id: string, version: number, atMs: number): Promise<boolean> {
    const t = await this.getTour(id);
    if (t.completedVersion !== null && t.completedVersion >= version) return false;
    this.tours.set(id, { ...t, completedAt: atMs, completedVersion: version });
    return true;
  }

  async markEmailVerified(id: string): Promise<void> {
    const rec = this.byId.get(id);
    if (rec) rec.emailVerified = true;
  }

  /** [BETA-6] Record terms acceptance (used by the in-memory invite-activation tx). */
  recordTerms(id: string, termsVersion: string, acceptedAt: number, acceptedIp: string | null): void {
    const rec = this.byId.get(id);
    if (rec) {
      rec.termsVersionAccepted = termsVersion;
      rec.termsAcceptedAt = acceptedAt;
      rec.termsAcceptedIp = acceptedIp;
    }
  }

  async delete(id: string): Promise<void> {
    const rec = this.byId.get(id);
    if (rec) {
      this.byId.delete(id);
      this.byEmail.delete(rec.email);
      this.byCode.delete(rec.referralCode);
    }
  }

  async listAllIds(): Promise<string[]> {
    return [...this.byId.keys()];
  }

  count(): number {
    return this.byId.size;
  }
}
