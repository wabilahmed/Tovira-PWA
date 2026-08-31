/**
 * Per-file harness wiring. Call `useHarness()` at the top of a suite: it builds an
 * anonymous HTTP client, an IdentityFactory, and a Reporter, and registers an
 * afterAll that tears down every account the file created (rail #3) — even on failure.
 */
import { afterAll } from 'vitest';
import { resolveTarget, type Target } from './env.js';
import { HttpClient } from './http.js';
import { IdentityFactory } from './identity.js';
import { Reporter } from './report.js';

export interface Harness {
  target: Target;
  anon: HttpClient; // unauthenticated client for signup/login/probes
  factory: IdentityFactory;
  report: Reporter;
}

export function useHarness(): Harness {
  const target = resolveTarget();
  const anon = new HttpClient(target);
  const factory = new IdentityFactory(target);
  const report = new Reporter();

  afterAll(async () => {
    const { deleted, failed } = await factory.teardownAll();
     
    console.log(`  teardown: ${deleted} account(s) deleted${failed ? `, ${failed} failed` : ''}`);
  });

  return { target, anon, factory, report };
}
