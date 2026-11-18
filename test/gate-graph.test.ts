// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { gateImportGraph, forcesGate, modelSettingChanged } from '../scripts/ops/gate-graph.js';
import { decideInherit } from '../scripts/ops/inherit-verdict.js';
import type { VerdictRecord } from '../apps/api/src/eval/deploy-ledger.js';

/**
 * [P75 · owner] The gate runs only when something it scores could have changed, not on every API change:
 *  - anything the gate's code imports at RUNTIME, worked out from the import graph on every CI run (type-only imports
 *    are ignored). The roots are all of apps/api/src/eval/ and the model client the gate builds (adapters/model/, the
 *    spend wrapper); container.ts is on the fixed list and not followed (it imports the whole app);
 *  - plus the fixed list: adapters/model/, container.ts, config.ts, all of eval/, package.json, package-lock.json,
 *    apps/api/package.json, docker/api.prod.Dockerfile, and any prompt-version or model change (the prompt version is
 *    in prompt.ts, in the graph; a model setting is config.ts or a MODEL/ANTHROPIC/BEDROCK/EXTRACT_ line in ecs.tf);
 *  - fail closed: if the import graph can't be read, the gate runs.
 */
const ROOT = process.cwd();
const graph = gateImportGraph(ROOT);
const verdict = (sha: string): VerdictRecord => ({ type: 'verdict', sha, runId: '1', attempt: 1, at: '2026-11-18T10:00:00Z', mode: 'normal', deployGate: 'PASS', certification: 'PROVISIONAL', counters: { fab: 0 }, certFingerprint: 'fp1' });
const base = { sha: 'head000', runId: '9', attempt: 1, now: '2026-11-18T12:00:00Z', ledger: [verdict('base000')], ancestors: ['base000'] };
const decide = (changed: string[], o: Partial<Parameters<typeof decideInherit>[0]> = {}) =>
  decideInherit({ ...base, changedSince: () => changed, gateFiles: () => graph, ...o });

/** P75's API changes (the WhatsApp verify): routes, wiring, stores, the WhatsApp service, email, admin. */
const WHATSAPP_ONLY = [
  'apps/api/src/http/whatsapp-routes.ts', 'apps/api/src/services/whatsapp/whatsapp-service.ts', 'apps/api/src/services/whatsapp/copy.ts',
  'apps/api/src/adapters/whatsapp/pg-whatsapp-store.ts', 'apps/api/src/adapters/whatsapp/in-memory-whatsapp-store.ts', 'apps/api/src/ports/whatsapp.ts',
  'apps/api/src/whatsapp-wiring.ts', 'apps/api/src/index.ts', 'apps/api/src/server.ts', 'apps/api/src/http/admin-console-routes.ts',
  'apps/api/src/services/access/access-request-service.ts', 'apps/api/src/services/access/access-approval-service.ts',
  'apps/api/src/services/email/account-email-service.ts', 'apps/api/src/ports/access-request-repository.ts',
  'apps/api/src/adapters/access/pg-access-request-repository.ts', 'apps/api/migrations/0118_whatsapp_verify.sql',
  'apps/web/src/whatsapp/WhatsAppBanner.tsx', 'apps/web/privacy/index.html', 'legal-archive/2026-11-18/privacy.html',
];

describe('[P75] the gate\'s import graph (this checkout)', () => {
  it('holds the extraction pipeline, the redaction and safety cuts, the scorer and the model client', () => {
    for (const f of ['services/extraction/prompt.ts', 'services/extraction/extraction-service.ts', 'services/extraction/parse.ts', 'services/extraction/validate.ts',
      'services/extraction/counterpart.ts', 'services/extraction/resolve-date.ts', 'services/redaction/redact.ts', 'services/privacy/pregnancy-cut.ts',
      'services/screening/precise-screen.ts', 'eval/gate.ts', 'eval/score.ts', 'eval/eval-set.ts', 'adapters/model/anthropic.ts', 'adapters/spend/gated-ai-clients.ts']) {
      expect(graph.has(`apps/api/src/${f}`), f).toBe(true);
    }
  });
  it('NEGATIVE: holds none of the WhatsApp, routing, wiring, email or admin code (container.ts is not followed)', () => {
    for (const f of WHATSAPP_ONLY.filter((p) => p.endsWith('.ts'))) expect(graph.has(f), f).toBe(false);
    expect(graph.has('apps/api/src/container.ts')).toBe(false);
  });
});

describe('[P75] the gate decision', () => {
  it('a WhatsApp-only change (P75) skips: its verdict is carried forward', () => {
    const d = decide(WHATSAPP_ONLY);
    expect(d.inherit).toBe(true);
    expect(d.reason).toMatch(/nothing the gate scores changed/);
  });
  it('NEGATIVE: a change to an extraction file runs the gate', () => {
    for (const f of ['apps/api/src/services/extraction/prompt.ts', 'apps/api/src/services/extraction/resolve-date.ts', 'apps/api/src/services/redaction/redact.ts']) {
      const d = decide([...WHATSAPP_ONLY, f]);
      expect(d.inherit, f).toBe(false);
      expect(d.reason, f).toContain(f.replace('apps/api/src/', ''));
    }
  });
  it.each([
    'apps/api/src/adapters/model/anthropic.ts', 'apps/api/src/adapters/model/new-provider.ts', 'apps/api/src/container.ts', 'apps/api/src/config.ts',
    'apps/api/src/eval/new-fixture-data.json', 'apps/api/src/eval/index.ts', 'package.json', 'package-lock.json', 'apps/api/package.json', 'docker/api.prod.Dockerfile',
  ])('NEGATIVE: the fixed list: %s runs the gate', (p) => {
    expect(forcesGate(p, graph)).toBe(true);
    expect(decide([p]).inherit).toBe(false);
  });
  it('NEGATIVE: a model setting in ecs.tf runs the gate; another setting there does not', () => {
    expect(modelSettingChanged('-      { name = "MODEL_AUX", value = "claude-haiku-5-5" },\n+      { name = "MODEL_AUX", value = "claude-haiku-6" },')).toBe(true);
    expect(modelSettingChanged('+      { name = "MODEL_EXTRACT", value = "claude-sonnet-5-5" },')).toBe(true);
    expect(modelSettingChanged('+      { name = "EXTRACT_WINDOWED", value = "0" },')).toBe(true);
    expect(modelSettingChanged('+      { name = "WHATSAPP_INGEST_ENABLED", value = "true" },')).toBe(false);
    const tf = 'infra/terraform/ecs.tf';
    expect(decide([tf], { diffOf: () => '+      { name = "ANTHROPIC_MODEL", value = "x" },' }).inherit).toBe(false);
    expect(decide([tf], { diffOf: () => '+      { name = "WHATSAPP_MODE", value = "real" },' }).inherit).toBe(true);
    expect(decide([tf], { diffOf: () => { throw new Error('git'); } }).inherit, 'unreadable diff: fail closed').toBe(false);
  });
  it('NEGATIVE: a broken import graph runs the gate (fail closed)', () => {
    const d = decide(WHATSAPP_ONLY, { gateFiles: () => { throw new Error('cannot read apps/api/src/eval'); } });
    expect(d.inherit).toBe(false);
    expect(d.reason).toMatch(/import graph.*failing closed/);
  });
});

describe('[P75] reading the graph (a small repo)', () => {
  const repo = (files: Record<string, string>) => {
    const dir = mkdtempSync(join(tmpdir(), 'gate-graph-'));
    for (const [p, c] of Object.entries(files)) { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), c); }
    return dir;
  };
  const MIN = {
    'apps/api/src/eval/gate.ts': "import { x } from '../services/extraction/a.js';\nimport type { T } from '../services/whatsapp/t.js';\nimport { type U } from '../ports/u.js';\nexport { y } from './y.js';\nimport { z } from '../container.js';\n",
    'apps/api/src/eval/y.ts': "export const y = 1; const m = () => import('../services/dyn.js');\n",
    'apps/api/src/services/extraction/a.ts': "import { b } from './b.js';\nexport const x = b;\n",
    'apps/api/src/services/extraction/b.ts': 'export const b = 1;\n',
    'apps/api/src/services/dyn.ts': 'export {};\n',
    'apps/api/src/services/whatsapp/t.ts': 'export type T = 1;\n',
    'apps/api/src/ports/u.ts': 'export type U = 1;\n',
    'apps/api/src/container.ts': "import { w } from './services/whatsapp/w.js';\nexport const z = w;\n",
    'apps/api/src/services/whatsapp/w.ts': 'export const w = 1;\n',
    'apps/api/src/adapters/model/m.ts': 'export const m = 1;\n',
    'apps/api/src/adapters/spend/gated-ai-clients.ts': 'export const g = 1;\n',
  };
  it('follows runtime imports, re-exports and dynamic imports; ignores type-only imports; does not follow container.ts', () => {
    const g = gateImportGraph(repo(MIN));
    expect([...g].sort()).toEqual([
      'apps/api/src/adapters/model/m.ts', 'apps/api/src/adapters/spend/gated-ai-clients.ts', 'apps/api/src/eval/gate.ts', 'apps/api/src/eval/y.ts',
      'apps/api/src/services/dyn.ts', 'apps/api/src/services/extraction/a.ts', 'apps/api/src/services/extraction/b.ts',
    ]);
  });
  it('NEGATIVE: an import that resolves to nothing, or no eval/ folder, cannot be read: it throws', () => {
    expect(() => gateImportGraph(repo({ ...MIN, 'apps/api/src/eval/gate.ts': "import { x } from '../services/extraction/missing.js';\n" }))).toThrow(/missing/);
    expect(() => gateImportGraph(repo({ 'apps/api/src/x.ts': '' }))).toThrow();
  });
});

describe('[P75] the script on a real git history', () => {
  const SCRIPT = resolve(ROOT, 'scripts/ops/inherit-verdict.ts');
  it('a WhatsApp-only commit: GATE SKIPPED; then an extraction change: GATE RUNS; a broken graph: GATE RUNS', () => {
    const dir = mkdtempSync(join(tmpdir(), 'inherit-graph-'));
    const g = (...a: string[]) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' }).trim();
    const put = (p: string, c: string) => { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), c); };
    g('init', '-q'); g('config', 'user.email', 't@example.invalid'); g('config', 'user.name', 't');
    put('apps/api/src/eval/gate.ts', "import { x } from '../services/extraction/a.js';\nexport const r = x;\n");
    put('apps/api/src/services/extraction/a.ts', "import { y } from './b.js';\nexport const x = y;\n");
    put('apps/api/src/services/extraction/b.ts', 'export const y = 1;\n');
    put('apps/api/src/services/whatsapp/w.ts', 'export const w = 1;\n');
    g('add', '.'); g('commit', '-qm', 'base');
    const b = g('rev-parse', 'HEAD');
    const run = () => {
      writeFileSync(join(dir, 'ledger.jsonl'), JSON.stringify(verdict(b)) + '\n');
      const o = join(dir, 'gh-out'); writeFileSync(o, '');
      const r = spawnSync('npx', ['tsx', SCRIPT], { cwd: dir, encoding: 'utf8', env: { ...process.env, SHA: g('rev-parse', 'HEAD'), LEDGER_FILE: join(dir, 'ledger.jsonl'), OUT: join(dir, 'v.jsonl'), GITHUB_OUTPUT: o, GITHUB_RUN_ID: '7' } });
      return { out: r.stdout, gh: readFileSync(o, 'utf8') };
    };
    put('apps/api/src/services/whatsapp/w.ts', 'export const w = 2;\n'); g('commit', '-qam', 'whatsapp');
    let r = run();
    expect(r.gh).toBe('inherited=1\n');
    expect(r.out).toContain('GATE SKIPPED');
    put('apps/api/src/services/extraction/b.ts', 'export const y = 2;\n'); g('commit', '-qam', 'extraction');
    r = run();
    expect(r.gh).toBe('inherited=0\n');
    expect(r.out).toContain('GATE RUNS');
    // a broken graph: a graph file's import now resolves to nothing (only b.ts deleted, plus a WhatsApp change)
    g('reset', '-q', '--hard', 'HEAD~1');
    g('rm', '-q', 'apps/api/src/services/extraction/b.ts');
    put('apps/api/src/services/whatsapp/w.ts', 'export const w = 3;\n'); g('commit', '-qam', 'broken');
    r = run();
    expect(r.gh).toBe('inherited=0\n');
    expect(r.out).toMatch(/GATE RUNS.*import graph/);
  }, 60_000);
});
