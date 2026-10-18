import { describe, it, expect } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * [P26-3] scripts/ops/append-fab-ledger.sh — the one way CI writes the ledger (the "started" record and the
 * result record). It appends one line per call on top of what is there (a fast-forward push, never a
 * rewrite), refuses an empty or multi-line record, and never writes any git config (the bot identity is
 * per-command). Runs against a throwaway bare repo, with HOME pointed at a temp dir.
 */
const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const script = join(repo, 'scripts/ops/append-fab-ledger.sh');

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'afl-'));
  const home = join(dir, 'home');
  const env = { ...process.env, HOME: home, GIT_CONFIG_NOSYSTEM: '1', RUNNER_TEMP: dir };
  execFileSync('mkdir', ['-p', home]);
  const g = (args: string[], cwd = dir) => execFileSync('git', args, { cwd, env, encoding: 'utf8' });
  g(['init', '-q', '--bare', 'origin.git']);
  g(['init', '-q', 'seed']);
  writeFileSync(join(dir, 'seed/fab-ledger.jsonl'), '{"type":"genesis","createdAt":"2026-10-18T00:00:00Z"}\n');
  g(['add', 'fab-ledger.jsonl'], join(dir, 'seed'));
  g(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'genesis'], join(dir, 'seed'));
  g(['push', '-q', join(dir, 'origin.git'), 'HEAD:gate-ledger'], join(dir, 'seed'));
  g(['clone', '-q', join(dir, 'origin.git'), 'job']);
  const run = (record: string, msg: string) => {
    const f = join(dir, `r-${Math.random()}.jsonl`);
    writeFileSync(f, record);
    return spawnSync('bash', [script, f, msg], { cwd: join(dir, 'job'), env, encoding: 'utf8' });
  };
  return { dir, home, g, run };
}

describe('[P26-3] append-fab-ledger.sh', () => {
  it('appends one line per call on top of the existing ledger (history kept, nothing rewritten)', () => {
    const s = setup();
    expect(s.run('{"type":"started","runId":"1"}\n', 'gate started: 1').status).toBe(0);
    expect(s.run('{"type":"run","runId":"1"}\n', 'gate: 1').status).toBe(0);
    const ledger = s.g(['--git-dir', 'origin.git', 'show', 'gate-ledger:fab-ledger.jsonl']).trim().split('\n');
    expect(ledger.map((l) => JSON.parse(l).type)).toEqual(['genesis', 'started', 'run']);
    expect(s.g(['--git-dir', 'origin.git', 'log', '--format=%s', 'gate-ledger']).trim().split('\n')).toEqual(['gate: 1', 'gate started: 1', 'genesis']);
  });

  it('NEGATIVE: refuses an empty record or more than one line', () => {
    const s = setup();
    expect(s.run('', 'x').status).not.toBe(0);
    expect(s.run('{"a":1}\n{"b":2}\n', 'x').status).not.toBe(0);
    expect(s.g(['--git-dir', 'origin.git', 'show', 'gate-ledger:fab-ledger.jsonl']).trim().split('\n')).toHaveLength(1);
  });

  it('NEGATIVE: never writes git config (the bot identity is per-command)', () => {
    const s = setup();
    expect(s.run('{"type":"run"}\n', 'gate: x').status).toBe(0);
    expect(existsSync(join(s.home, '.gitconfig'))).toBe(false);
    expect(readFileSync(join(s.dir, 'job/.git/config'), 'utf8')).not.toMatch(/github-actions/);
  });
});
