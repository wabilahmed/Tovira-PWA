/**
 * [P72-2 · owner] Settings-only deploys: "ecs.tf change → provision plan → my yes → apply → force a new ECS deployment
 * of the same image. No API image rebuild." If nothing the API image is built from (touchesApiImage, the same list the
 * gate's carry-forward uses) changed between the commit of the image the service is RUNNING and this commit, the
 * deploy puts this commit's tag on that same image in ECR (no build: byte for byte the same image) and rolls the
 * latest task definition (the new settings) with it, stamped with this commit. Anything else, or any doubt (no
 * running image, a tag that is not a commit, a git error), builds as before: fail closed.
 *
 * CI: RUNNING_IMAGE (the service's current image), SHA, ECR_REPOSITORY, GITHUB_OUTPUT. Writes reuse=1|0 and from=<tag>.
 * Needs the full git history (checkout fetch-depth: 0).
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { touchesApiImage } from './inherit-verdict.js';

export type ReuseDecision = { reuse: true; fromTag: string; reason: string } | { reuse: false; reason: string };

export function decideReuse(i: { runningImage: string; sha: string; changedSince: (base: string) => string[]; repository?: string }): ReuseDecision {
  const m = /^([^/\s]+)\/([^:@\s]+):([0-9a-f]{40})$/.exec(i.runningImage.trim()); // registry/repo:<commit>
  if (!m) return { reuse: false, reason: `the running image is not a commit-tagged API image (${i.runningImage || 'none'})` };
  const repo = m[2]!;
  const tag = m[3]!;
  if (repo !== (i.repository ?? 'tovira/api')) return { reuse: false, reason: `the running image is from ${repo}, not the API repository` };
  if (tag === i.sha) return { reuse: false, reason: 'the running image is already this commit' };
  let changed: string[];
  try { changed = i.changedSince(tag); } catch (e) { return { reuse: false, reason: `cannot compare with ${tag.slice(0, 7)}: ${e instanceof Error ? e.message : String(e)}` }; }
  const api = changed.filter(touchesApiImage);
  if (api.length > 0) return { reuse: false, reason: `the API image changed since ${tag.slice(0, 7)} (${api.slice(0, 5).join(', ')}${api.length > 5 ? ', …' : ''})` };
  return { reuse: true, fromTag: tag, reason: `nothing in the API image changed since the running ${tag.slice(0, 7)} (${changed.length} file${changed.length === 1 ? '' : 's'} changed, none in it): retag it, no build` };
}

function main(): void {
  const env = process.env;
  const out = (kv: Record<string, string>): void => { if (env.GITHUB_OUTPUT) for (const [k, v] of Object.entries(kv)) appendFileSync(env.GITHUB_OUTPUT, `${k}=${v}\n`); };
  try {
    const sha = env.SHA ?? '';
    const d = decideReuse({
      runningImage: env.RUNNING_IMAGE ?? '', sha, repository: env.ECR_REPOSITORY || 'tovira/api',
      changedSince: (base) => execFileSync('git', ['diff', '--name-only', base, sha], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim().split('\n').filter(Boolean),
    });
    console.log(`[reuse-api-image] ${d.reuse ? 'RETAG, NO BUILD' : 'BUILD'}: ${d.reason}`);
    out(d.reuse ? { reuse: '1', from: d.fromTag } : { reuse: '0', from: '' });
  } catch (err) {
    console.log(`[reuse-api-image] BUILD: ${err instanceof Error ? err.message : String(err)} (failing closed)`);
    out({ reuse: '0', from: '' });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
