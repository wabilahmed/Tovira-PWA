/**
 * STAGING-1 — scaffold self-check. Proves the harness itself works end-to-end against
 * the live staging server before any real suite depends on it: the target guard, the
 * cookie-jar client, the identity factory (signup → authenticated session), the /me
 * round-trip, unauthenticated rejection, and teardown (delete). Reuses the eval-set
 * ground truth via the fixtures module (no invented facts).
 */
import { describe, it, expect } from 'vitest';
import { useHarness } from './lib/harness.js';
import { allEvalNotes, whatsappExportFromEval, TRAP_NOTES } from './lib/fixtures.js';

const h = useHarness();

describe('[STAGING-1] harness scaffold', () => {
  it('staging /api/health is 200', async () => {
    const res = await h.anon.get('/health');
    if (res.status !== 200) h.report.fail('A', 'STAGING-1', 'health', `expected 200, got ${res.status}`, h.anon.lastExchange());
    expect(res.status).toBe(200);
    h.report.pass('A', 'STAGING-1', 'health');
  });

  it('newRep signs up a fresh namespaced identity and authenticates', async () => {
    const rep = await h.factory.newRep();
    expect(rep.email).toMatch(/^qa\+/);
    expect(rep.userId).toBeTruthy();
    expect(rep.http.sessionCookie()).toBeTruthy(); // cookie jar holds the session

    const me = await rep.http.get<{ email?: string; userId?: string }>('/me');
    expect(me.status).toBe(200);
    h.report.pass('A', 'STAGING-1', 'signup + authenticated /me');
  });

  it('an unauthenticated /me is rejected 401', async () => {
    const res = await h.anon.get('/me');
    expect(res.status).toBe(401);
    h.report.pass('A', 'STAGING-1', 'anon /me → 401');
  });

  it('reuses eval-set ground truth (fixtures do not invent facts)', () => {
    expect(allEvalNotes.length).toBeGreaterThan(0);
    const { text, groundTruth } = whatsappExportFromEval('Acme', [TRAP_NOTES.firmPromise, TRAP_NOTES.codeSwitch]);
    expect(text).toContain('] '); // WhatsApp header rendered
    expect(groundTruth).toHaveLength(2);
    expect(groundTruth[0]!.expected.promises.length).toBeGreaterThan(0);
    h.report.pass('A', 'STAGING-1', 'fixtures reuse eval ground truth');
  });

  it('teardown deletes what the factory created (verified by a dead session)', async () => {
    const rep = await h.factory.newRep();
    const del = await rep.http.del('/account');
    expect(del.status).toBe(200);
    // After deletion the session must no longer resolve.
    const after = await rep.http.get('/me');
    expect(after.status).toBe(401);
    h.report.pass('A', 'STAGING-1', 'delete → session dead');
  });
});
