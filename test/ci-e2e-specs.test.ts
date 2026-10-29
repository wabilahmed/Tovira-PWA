import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// [P58 · owner] billing-return.spec.ts went stale for two weeks (P14-4a changed the success page) because CI never ran
// it. The stub-API browser specs CI runs: a spec that is not listed here can rot unseen.
describe('[P58] CI runs the stub-API browser specs', () => {
  it('billing-return and new-client run beside landing-usecases and app-layout', () => {
    const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
    const run = ci.split('\n').find((l) => l.includes('npx playwright test ')) ?? '';
    for (const spec of ['landing-usecases.spec.ts', 'app-layout.spec.ts', 'billing-return.spec.ts', 'new-client.spec.ts']) expect(run, spec).toContain(`apps/web/e2e/${spec}`);
  });
});
