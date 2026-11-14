// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { decideInherit, touchesApiImage } from '../scripts/ops/inherit-verdict.js';
import { parseDeployLedger, type VerdictRecord } from '../apps/api/src/eval/deploy-ledger.js';

/**
 * [P70 · owner] "since this will be only a frontend deploy do not run the 12 aed gate". A push that changes nothing the
 * API image is built from carries forward its nearest verdicted ancestor's verdict; anything else runs the gate.
 */
const verdict = (sha: string, o: Partial<VerdictRecord> = {}): VerdictRecord => ({
  type: 'verdict', sha, runId: '1', attempt: 1, at: '2026-11-14T10:00:00Z', mode: 'normal', deployGate: 'PASS', certification: 'PROVISIONAL', counters: { fab: 0 }, certFingerprint: 'fp1', ...o,
});
const base = { sha: 'head000', runId: '99', attempt: 1, now: '2026-11-14T12:00:00Z' };

describe('[P70] the API image inputs', () => {
  it.each(['package.json', 'package-lock.json', 'apps/web/package.json', 'apps/api/src/server.ts', 'apps/api/migrations/0120_x.sql'])('%s needs the gate', (p) => {
    expect(touchesApiImage(p)).toBe(true);
  });
  it.each(['apps/web/index.html', 'apps/web/src/marketing/game.ts', 'apps/web/e2e/landing-usecases.spec.ts', '.github/workflows/ci.yml', 'scripts/ops/inherit-verdict.ts', 'test/inherit-verdict.test.ts', 'CLAUDE.md'])('%s does not', (p) => {
    expect(touchesApiImage(p)).toBe(false);
  });
  it('the list matches what docker/api.prod.Dockerfile copies', () => {
    const df = readFileSync(resolve(process.cwd(), 'docker/api.prod.Dockerfile'), 'utf8');
    const copies = [...df.matchAll(/^COPY (?!--from)(.+) \S+$/gm)].flatMap((m) => m[1]!.split(/\s+/));
    expect(new Set(copies)).toEqual(new Set(['package.json', 'package-lock.json', 'apps/api/package.json', 'apps/web/package.json', 'apps/api']));
    for (const c of copies) expect(touchesApiImage(c === 'apps/api' ? 'apps/api/x' : c), c).toBe(true);
  });
});

describe('[P70] carrying a verdict forward', () => {
  it('a web-only change carries the nearest verdicted ancestor\'s verdict, as an ordinary verdict', () => {
    const d = decideInherit({ ...base, ledger: [verdict('old0000', { deployGate: 'FAIL' }), verdict('base000', { mode: 'full-cert', certification: 'PASS' })], ancestors: ['mid0000', 'base000', 'old0000'], changedSince: () => ['apps/web/index.html', '.github/workflows/ci.yml'] });
    expect(d.inherit).toBe(true);
    if (!d.inherit) return;
    expect(d.record).toEqual({ type: 'verdict', sha: 'head000', runId: '99', attempt: 1, at: '2026-11-14T12:00:00Z', mode: 'normal', deployGate: 'PASS', certification: 'PASS', counters: { fab: 0 }, certFingerprint: 'fp1', inheritedFrom: 'base000' });
    expect(parseDeployLedger(JSON.stringify(d.record))).toHaveLength(1); // the deploy ledger accepts it
  });
  it('NEGATIVE: an API-image change runs the gate', () => {
    for (const p of ['apps/api/src/services/extraction/extraction-service.ts', 'package-lock.json', 'apps/web/package.json']) {
      const d = decideInherit({ ...base, ledger: [verdict('base000')], ancestors: ['base000'], changedSince: () => ['apps/web/index.html', p] });
      expect(d.inherit, p).toBe(false);
    }
  });
  it('NEGATIVE: no verdicted ancestor runs the gate', () => {
    expect(decideInherit({ ...base, ledger: [verdict('elsewhere')], ancestors: ['a', 'b'], changedSince: () => [] }).inherit).toBe(false);
  });
  it('a FAIL is carried forward as a FAIL (so the deploy is still refused)', () => {
    const d = decideInherit({ ...base, ledger: [verdict('base000', { deployGate: 'FAIL', certification: 'FAIL' })], ancestors: ['base000'], changedSince: () => ['apps/web/index.html'] });
    expect(d.inherit && [d.record.deployGate, d.record.certification]).toEqual(['FAIL', 'FAIL']);
  });
  it('the base\'s latest verdict is the one carried', () => {
    const d = decideInherit({ ...base, ledger: [verdict('base000', { deployGate: 'FAIL', at: '1' }), verdict('base000', { deployGate: 'PASS', at: '2', runId: '2' })], ancestors: ['base000'], changedSince: () => [] });
    expect(d.inherit && d.record.deployGate).toBe('PASS');
  });
});

describe('[P70] the script, on a real git history (fails closed)', () => {
  const SCRIPT = resolve(process.cwd(), 'scripts/ops/inherit-verdict.ts');
  const repo = () => {
    const dir = mkdtempSync(join(tmpdir(), 'inherit-'));
    const g = (...a: string[]) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' }).trim();
    g('init', '-q'); g('config', 'user.email', 't@example.invalid'); g('config', 'user.name', 't');
    mkdirSync(join(dir, 'apps/web'), { recursive: true }); mkdirSync(join(dir, 'apps/api'), { recursive: true });
    writeFileSync(join(dir, 'apps/api/a.ts'), '1'); writeFileSync(join(dir, 'apps/web/index.html'), '1');
    g('add', '.'); g('commit', '-qm', 'base');
    return { dir, g, sha: () => g('rev-parse', 'HEAD') };
  };
  const run = (dir: string, sha: string, ledger: string) => {
    writeFileSync(join(dir, 'ledger.jsonl'), ledger);
    const o = join(dir, 'gh-out'); writeFileSync(o, '');
    const r = spawnSync('npx', ['tsx', SCRIPT], { cwd: dir, encoding: 'utf8', env: { ...process.env, SHA: sha, LEDGER_FILE: join(dir, 'ledger.jsonl'), OUT: join(dir, 'verdict.jsonl'), GITHUB_OUTPUT: o, GITHUB_RUN_ID: '7' } });
    return { out: r.stdout, gh: readFileSync(o, 'utf8') };
  };

  it('web-only since the verdicted commit: GATE SKIPPED, verdict written; an API change: GATE RUNS', () => {
    const { dir, g, sha } = repo();
    const b = sha();
    writeFileSync(join(dir, 'apps/web/index.html'), '2'); g('commit', '-qam', 'web');
    const web = run(dir, sha(), JSON.stringify(verdict(b)) + '\n');
    expect(web.gh).toBe('inherited=1\n');
    expect(web.out).toContain('GATE SKIPPED');
    expect(JSON.parse(readFileSync(join(dir, 'verdict.jsonl'), 'utf8')).inheritedFrom).toBe(b);
    writeFileSync(join(dir, 'apps/api/a.ts'), '2'); g('commit', '-qam', 'api');
    const api = run(dir, sha(), JSON.stringify(verdict(b)) + '\n');
    expect(api.gh).toBe('inherited=0\n');
    expect(api.out).toContain('GATE RUNS');
  }, 30_000);

  it('NEGATIVE: an unreadable ledger runs the gate', () => {
    const { dir, g, sha } = repo();
    writeFileSync(join(dir, 'apps/web/index.html'), '2'); g('commit', '-qam', 'web');
    const r = run(dir, sha(), 'not json\n');
    expect(r.gh).toBe('inherited=0\n');
    expect(r.out).toContain('failing closed');
  }, 30_000);
});
