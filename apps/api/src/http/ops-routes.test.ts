import { describe, it, expect } from 'vitest';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleOpsRoute, type OpsRouteDeps } from './ops-routes.js';
import { InMemorySpendOverrideRepository } from '../adapters/spend/in-memory-spend-override-repository.js';

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
    spend: { status: async () => ({ periodKey: 'p:2026-09', spentAed: 50, capAed: 45, state: 'capped' }) },
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
