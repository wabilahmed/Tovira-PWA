import { describe, it, expect } from 'vitest';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleOpsRoute, type OpsRouteDeps } from './ops-routes.js';
import { InMemorySpendOverrideRepository } from '../adapters/spend/in-memory-spend-override-repository.js';
import { InMemorySpendLedgerRepository } from '../adapters/spend/in-memory-spend-ledger-repository.js';
import { SpendService } from '../services/spend/spend-service.js';

function req(method: string, url: string, headers: Record<string, string> = {}, body?: unknown): IncomingMessage {
  const r = Readable.from([Buffer.from(body === undefined ? '' : JSON.stringify(body))]) as unknown as IncomingMessage;
  r.method = method;
  r.url = url;
  r.headers = headers;
  return r;
}
function res(): { res: ServerResponse; status: () => number; body: () => unknown } {
  let statusCode = 0;
  let payload = '';
  const r = {
    setHeader() {},
    writeHead(code: number) { statusCode = code; return this; },
    end(chunk?: string) { if (chunk) payload = chunk; },
  } as unknown as ServerResponse;
  return { res: r, status: () => statusCode, body: () => (payload ? JSON.parse(payload) : undefined) };
}

function deps(over: Partial<OpsRouteDeps> = {}): { d: OpsRouteDeps; overrides: InMemorySpendOverrideRepository } {
  const overrides = new InMemorySpendOverrideRepository();
  const d: OpsRouteDeps = {
    opsToken: 'sekret',
    overrides,
    spend: {
      status: async () => ({ periodKey: 'p:2026-09', spentAed: 50, capAed: 45, state: 'capped' }),
      report: async () => [],
    },
    allUserIds: async () => [],
    ...over,
  };
  return { d, overrides };
}

describe('[SPEND-CAP · CAP-OVERRIDE] handleOpsRoute', () => {
  it('returns false for a non-ops URL (not its route)', async () => {
    const { d } = deps();
    const r = res();
    expect(await handleOpsRoute(req('GET', '/health'), r.res, d)).toBe(false);
  });

  it('a rep request (no ops token) cannot raise a cap — 403', async () => {
    const { d, overrides } = deps();
    const r = res();
    await handleOpsRoute(req('POST', '/ops/spend-cap/override', {}, { userId: 'rep-A', capAed: 90, reason: 'x' }), r.res, d);
    expect(r.status()).toBe(403);
    expect(await overrides.listAudit(10)).toHaveLength(0); // nothing written
  });

  it('a wrong token is rejected — 403', async () => {
    const { d } = deps();
    const r = res();
    await handleOpsRoute(req('POST', '/ops/spend-cap/override', { 'x-ops-token': 'nope' }, { userId: 'rep-A', capAed: 90, reason: 'x' }), r.res, d);
    expect(r.status()).toBe(403);
  });

  it('with the ops token, raises the cap for the current period and audits it', async () => {
    const { d, overrides } = deps();
    const r = res();
    await handleOpsRoute(
      req('POST', '/ops/spend-cap/override', { 'x-ops-token': 'sekret' }, { userId: 'rep-A', capAed: 90, reason: 'onboarding month', raisedBy: 'wabil' }),
      r.res, d,
    );
    expect(r.status()).toBe(200);
    const audit = await overrides.listAudit(10);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ userId: 'rep-A', periodKey: 'p:2026-09', capAed: 90, raisedBy: 'wabil', reason: 'onboarding month' });
    expect(audit[0]!.occurredAt).toBeGreaterThan(0);
  });

  it('validates the body — a missing reason is a 400, nothing written', async () => {
    const { d, overrides } = deps();
    const r = res();
    await handleOpsRoute(req('POST', '/ops/spend-cap/override', { 'x-ops-token': 'sekret' }, { userId: 'rep-A', capAed: 90 }), r.res, d);
    expect(r.status()).toBe(400);
    expect(await overrides.listAudit(10)).toHaveLength(0);
  });

  it('the audit endpoint returns the trail (ops-token gated)', async () => {
    const { d, overrides } = deps();
    await overrides.set({ userId: 'rep-A', periodKey: 'p', capAed: 90, raisedBy: 'wabil', reason: 'x' });
    const r = res();
    await handleOpsRoute(req('GET', '/ops/spend-cap/audit', { 'x-ops-token': 'sekret' }), r.res, d);
    expect(r.status()).toBe(200);
    expect((r.body() as { audit: unknown[] }).audit).toHaveLength(1);
  });

  it('is disabled when no ops token is configured (403 even with a token)', async () => {
    const { d } = deps({ opsToken: undefined });
    const r = res();
    await handleOpsRoute(req('GET', '/ops/spend-cap/audit', { 'x-ops-token': 'anything' }), r.res, d);
    expect(r.status()).toBe(403);
  });
});

// [SPEND-REPORT] GET /ops/spend — the per-rep cost readout, wiring the spend_ledger to a visible surface.
describe('[SPEND-REPORT] GET /ops/spend — per-rep Claude cost this period', () => {
  function realSpend() {
    const ledger = new InMemorySpendLedgerRepository();
    const spend = new SpendService(ledger, async () => 'p1', { capAed: 45, warnFraction: 0.8 });
    return { ledger, spend };
  }

  it('lists each rep most-expensive first, in AED + USD, with the per-class split; ops-token gated', async () => {
    const { ledger, spend } = realSpend();
    await ledger.add('rep-A', 'p1', 'import', 30);
    await ledger.add('rep-A', 'p1', 'recall', 2);
    await ledger.add('rep-B', 'p1', 'extraction', 5);
    const { d } = deps({ spend: spend as never, allUserIds: async () => ['rep-A', 'rep-B'] });

    const r = res();
    await handleOpsRoute(req('GET', '/ops/spend', { 'x-ops-token': 'sekret' }), r.res, d);
    expect(r.status()).toBe(200);
    const body = r.body() as { reps: Array<{ userId: string; spentAed: number; spentUsd: number; state: string; byClass: Array<{ costClass: string; aed: number }> }>; totalUsd: number };
    expect(body.reps.map((x) => x.userId)).toEqual(['rep-A', 'rep-B']); // dearest first (32 > 5)
    expect(body.reps[0]!.spentAed).toBe(32);
    expect(body.reps[0]!.spentUsd).toBeCloseTo(32 / 3.6725, 1); // AED→USD at the pegged rate
    expect(body.reps[0]!.byClass[0]!.costClass).toBe('import'); // dominant class first
    expect(body.reps[0]!.state).toBe('ok'); // 32 < 45 cap
    expect(body.totalUsd).toBeCloseTo(37 / 3.6725, 1);
  });

  it('requires the ops token (a rep cannot read every tenant\'s spend) — 403', async () => {
    const { spend } = realSpend();
    const { d } = deps({ spend: spend as never, allUserIds: async () => ['rep-A'] });
    const r = res();
    await handleOpsRoute(req('GET', '/ops/spend'), r.res, d); // no token
    expect(r.status()).toBe(403);
  });
});
