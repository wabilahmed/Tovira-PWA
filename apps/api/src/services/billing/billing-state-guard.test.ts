import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

/**
 * [BILLING-DUNNING · fix 1] billing_state is authoritative while the DB `status` stays 'active' during
 * payment_failed. So an ACCESS decision must never hand-roll a billing-lifecycle check — it must go
 * through the single billing-access module (billingGateDecision / aiPausedForState / entitlement()).
 *
 * This guard fails if any PRODUCTION file OUTSIDE the billing module mentions a billing-lifecycle state
 * literal ('payment_failed' | 'suspended' | 'ended'). A new ad-hoc `=== 'payment_failed'` check anywhere
 * else (sweep, checkout, a route, a job) would trip it — forcing the decision back through billing-access.
 */
const API_SRC = fileURLToPath(new URL('../../', import.meta.url)); // apps/api/src
const ALLOWED = ['services/billing/', 'adapters/billing/', 'ports/billing.ts'];
const LIFECYCLE = /'(payment_failed|suspended|ended)'/;

function prodFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...prodFiles(p));
    else if (p.endsWith('.ts') && !p.endsWith('.test.ts')) out.push(p);
  }
  return out;
}

describe('[BILLING-DUNNING] the raw billing status is never read for an access decision outside billing-access', () => {
  it('no production file outside the billing module hand-codes a billing-lifecycle state literal', () => {
    const offenders: string[] = [];
    for (const f of prodFiles(API_SRC)) {
      const rel = f.slice(API_SRC.length);
      if (ALLOWED.some((a) => rel.startsWith(a) || rel === a)) continue;
      const src = readFileSync(f, 'utf8');
      src.split('\n').forEach((line, i) => {
        if (LIFECYCLE.test(line)) offenders.push(`${rel}:${i + 1}  ${line.trim().slice(0, 100)}`);
      });
    }
    expect(offenders, `billing-lifecycle literals outside billing-access — route these through billingGateDecision/aiPausedForState:\n${offenders.join('\n')}`).toEqual([]);
  });
});
