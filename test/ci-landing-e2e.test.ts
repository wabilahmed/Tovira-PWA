import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// [P43-5] Owner: the 390px landing-page test runs in CI. Deploy waits for the whole CI workflow to succeed
// (deploy.yml: workflow_run, conclusion == success), so a broken landing layout never ships.
const ROOT = join(__dirname, '..');
const ci = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8');
const job = /\n {2}landing-e2e:\n([\s\S]*?)(?=\n {2}[a-z][a-z0-9-]*:\n|$)/.exec(ci)?.[1] ?? '';

describe('[P43-5] CI runs the landing 390px test', () => {
  it('a landing-e2e job installs Chromium and runs the landing spec', () => {
    expect(job, 'landing-e2e job in ci.yml').not.toBe('');
    expect(job).toMatch(/npm ci/);
    expect(job).toMatch(/npx playwright install --with-deps chromium/);
    expect(job).toMatch(/npx playwright test apps\/web\/e2e\/landing-usecases\.spec\.ts/);
    expect(existsSync(join(ROOT, 'apps/web/e2e/landing-usecases.spec.ts'))).toBe(true);
  });
  // [P46-6b] The app's 390px layout check (long text, long names) runs in the same job, so an overflow never ships.
  it('[P46-6b] the same job runs the app layout spec', () => {
    expect(job).toMatch(/npx playwright test [^\n]*apps\/web\/e2e\/app-layout\.spec\.ts/);
    expect(existsSync(join(ROOT, 'apps/web/e2e/app-layout.spec.ts'))).toBe(true);
  });
  it('deploy still waits for the CI workflow to succeed', () => {
    const deploy = readFileSync(join(ROOT, '.github/workflows/deploy.yml'), 'utf8');
    expect(deploy).toMatch(/workflow_run:\s*\n\s*workflows: \[CI\]/);
    expect(deploy).toMatch(/workflow_run\.conclusion == 'success'/);
  });
});
