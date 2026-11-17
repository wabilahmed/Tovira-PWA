// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { decideReuse } from '../scripts/ops/reuse-api-image.js';

/**
 * [P72-2 · owner] "Make the switches settings-only: ecs.tf change → provision plan → my yes → apply → force a new ECS
 * deployment of the same image. No API image rebuild." When nothing the API image is built from changed since the
 * image the service is RUNNING, the deploy puts this commit's tag on that same image in ECR (no build, byte for byte
 * the same image) and rolls the latest task definition (the new settings) with it. Anything else, or any doubt, builds
 * as before.
 */
const REPO = '862070608699.dkr.ecr.eu-north-1.amazonaws.com/tovira/api';
const RUN = 'a'.repeat(40);
const SHA = 'b'.repeat(40);

describe('[P72-2] reuse the running image when the API image is unchanged', () => {
  it('a settings-only change (ecs.tf) reuses the running image', () => {
    const d = decideReuse({ runningImage: `${REPO}:${RUN}`, sha: SHA, changedSince: () => ['infra/terraform/ecs.tf', 'test/reuse-api-image.test.ts', 'BLOCKERS.md'] });
    expect(d).toMatchObject({ reuse: true, fromTag: RUN });
  });
  it('a web-only change reuses it too (the API image would be byte for byte the same)', () => {
    expect(decideReuse({ runningImage: `${REPO}:${RUN}`, sha: SHA, changedSince: () => ['apps/web/src/App.tsx'] }).reuse).toBe(true);
  });
  it('NEGATIVE: any change the image is built from builds a new image', () => {
    for (const f of ['apps/api/src/server.ts', 'apps/api/migrations/0117_free_access.sql', 'package-lock.json', 'package.json', 'apps/web/package.json']) {
      const d = decideReuse({ runningImage: `${REPO}:${RUN}`, sha: SHA, changedSince: () => ['infra/terraform/ecs.tf', f] });
      expect(d.reuse, f).toBe(false);
    }
  });
  it('NEGATIVE: the same commit as the running image needs no retag (the normal path reuses its own tag)', () => {
    expect(decideReuse({ runningImage: `${REPO}:${SHA}`, sha: SHA, changedSince: () => [] }).reuse).toBe(false);
  });
  it('NEGATIVE: any doubt builds: no running image, a tag that is not a commit, a git error', () => {
    expect(decideReuse({ runningImage: '', sha: SHA, changedSince: () => [] }).reuse).toBe(false);
    expect(decideReuse({ runningImage: `${REPO}:latest`, sha: SHA, changedSince: () => [] }).reuse).toBe(false);
    expect(decideReuse({ runningImage: `other/repo:${RUN}`, sha: SHA, changedSince: () => [] }).reuse).toBe(false);
    expect(decideReuse({ runningImage: `${REPO}:${RUN}`, sha: SHA, changedSince: () => { throw new Error('unknown revision'); } }).reuse).toBe(false);
  });
});

type Step = { name?: string; id?: string; if?: string; run?: string; uses?: string; with?: Record<string, unknown> };
const deploy = parse(readFileSync(join(process.cwd(), '.github/workflows/deploy.yml'), 'utf8')) as { jobs: Record<string, { steps: Step[] }> };

describe('[P72-2] deploy.yml', () => {
  const steps = deploy.jobs.api!.steps;
  it('reads the running image, decides, and retags it instead of building when the decision says so', () => {
    const decide = steps.find((s) => (s.run ?? '').includes('scripts/ops/reuse-api-image.ts'));
    expect(decide, 'the reuse decision').toBeDefined();
    const build = steps.find((s) => s.id === 'build')!;
    expect(steps.indexOf(decide!)).toBeLessThan(steps.indexOf(build));
    expect(build.run).toContain('steps.reuse.outputs.reuse');
    expect(build.run).toMatch(/aws ecr batch-get-image[\s\S]*aws ecr put-image/);
    expect(build.run).toContain('docker buildx build'); // the normal path stays
  });
  it('the checkout has the full history (the decision diffs the running commit with this one)', () => {
    const co = steps.find((s) => s.uses?.startsWith('actions/checkout'))!;
    expect(co.with?.['fetch-depth']).toBe(0);
  });
  it('NEGATIVE: the rendered task definition is still the latest revision (the new settings), stamped with this commit', () => {
    const td = steps.find((s) => s.id === 'taskdef')!;
    expect(td.run).toContain('describe-task-definition');
    expect(td.run).toContain('--task-definition "tovira-${DEPLOY_ENV}-api"');
    expect(JSON.stringify(steps.find((s) => s.id === 'render')!.with)).toContain('BUILD_SHA=${{ env.IMAGE_SHA }}');
  });
});
