/**
 * [P26-3] The gate's window key, and the "started" record CI appends when a gate job begins (before any
 * model call). A started record with no matching result line counts as a failure in the window, so a job
 * cancelled or killed before it scores can never drop out of the ledger.
 *   CI: npx tsx apps/api/src/eval/fab-started.ts > "$RUNNER_TEMP/fab-started.jsonl"
 */
import { pathToFileURL, fileURLToPath } from 'node:url';
import { loadConfig } from '../config.js';
import { PROMPT_VERSION } from '../services/extraction/prompt.js';
import { fabStartedLine, type FabWindowKey } from './fab-window.js';
import { fingerprintFiles, NARROW_SURFACE, CERT_SURFACE } from './extraction-fingerprint.js';

/** The model id the gate records — the same expression the gate itself uses. */
export function gateModelId(config: ReturnType<typeof loadConfig>): string {
  return config.modelProvider === 'anthropic' ? config.anthropicModel : 'stub';
}

/** prompt version + model + the narrow and certification fingerprints of the code in this checkout. */
export function gateWindowKey(modelId: string): FabWindowKey {
  const srcRoot = fileURLToPath(new URL('..', import.meta.url));
  return {
    promptVersion: PROMPT_VERSION,
    model: modelId,
    fingerprint: fingerprintFiles(srcRoot, NARROW_SURFACE),
    certFingerprint: fingerprintFiles(srcRoot, CERT_SURFACE),
  };
}

/** This job's run reference (GitHub run id + attempt; "local" off CI). */
export function gateRunRef(env: NodeJS.ProcessEnv = process.env): { sha: string; runId: string; attempt: number } {
  return { sha: env.GITHUB_SHA ?? 'local', runId: env.GITHUB_RUN_ID ?? 'local', attempt: Number(env.GITHUB_RUN_ATTEMPT ?? 1) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const key = gateWindowKey(gateModelId(loadConfig()));
  process.stdout.write(fabStartedLine({ type: 'started', ...gateRunRef(), at: new Date().toISOString(), ...key }));
}
