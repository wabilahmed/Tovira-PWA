// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * [P69 · owner] scripts/verify-commit.sh fails closed: a failing step stops the commit, even when its output is piped
 * through a command that succeeds (the P69-12 slip: `playwright test | grep … | tail && commit` committed on two
 * failing tests, because the pipe's status was tail's).
 */
const SCRIPT = resolve(process.cwd(), 'scripts/verify-commit.sh');
function run(steps: string[], opts: { dry?: boolean; cwd?: string } = {}) {
  const r = spawnSync('bash', [SCRIPT, 'test: a commit', 'f.txt'], {
    cwd: opts.cwd ?? process.cwd(),
    env: { ...process.env, VERIFY_STEPS: steps.join('\n'), VERIFY_DRY_RUN: opts.dry === false ? '0' : '1' },
    encoding: 'utf8',
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

describe('[P69] the verify chain fails closed', () => {
  it('every step passing: it would commit', () => {
    const r = run(['true', 'echo ok | tail -1']);
    expect(r.code).toBe(0);
    expect(r.out).toContain('WOULD COMMIT: test: a commit');
  });

  it('NEGATIVE: a failing step stops it, and no later step runs', () => {
    const r = run(['true', 'exit 3', 'echo SHOULD-NOT-RUN']);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('VERIFY FAILED (exit 3): exit 3');
    expect(r.out).not.toContain('WOULD COMMIT');
    expect(r.out).not.toContain('verify: echo SHOULD-NOT-RUN');
  });

  it('NEGATIVE: a failing test piped into grep and tail still fails (pipefail)', () => {
    const r = run(['echo "2 failed" && exit 1 | grep -E "passed|failed" | tail -5', '(echo "2 failed"; exit 1) | grep -E "passed|failed" | tail -5']);
    expect(r.code).not.toBe(0);
    expect(r.out).not.toContain('WOULD COMMIT');
  });

  it('NEGATIVE: for real (not a dry run), a failing step leaves the repository without a new commit', () => {
    const dir = mkdtempSync(join(tmpdir(), 'verify-commit-'));
    const git = (...a: string[]) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' });
    git('init', '-q'); git('config', 'user.email', 't@example.com'); git('config', 'user.name', 'T');
    writeFileSync(join(dir, 'f.txt'), 'a'); git('add', 'f.txt'); git('commit', '-q', '-m', 'first');
    writeFileSync(join(dir, 'f.txt'), 'b');
    const r = run(['(exit 1) | tail -1'], { dry: false, cwd: dir });
    expect(r.code).not.toBe(0);
    expect(git('log', '--oneline').trim().split('\n')).toHaveLength(1);
    const ok = run(['true'], { dry: false, cwd: dir });
    expect(ok.code).toBe(0);
    expect(git('log', '--oneline').trim().split('\n')).toHaveLength(2);
  });

  it('the default steps include the Playwright suite (the step that slipped)', () => {
    const r = spawnSync('grep', ['-c', 'npx playwright test', SCRIPT], { encoding: 'utf8' });
    expect(Number(r.stdout.trim())).toBeGreaterThan(0);
  });
});
