/**
 * [P52 · owner] deploy.yml's decide job: may this commit deploy? Reads the deploy ledger (deploy-ledger.jsonl from the
 * gate-ledger branch) and the trigger from the environment, prints the decision, and exits 1 on a refusal so neither the
 * api nor the web job runs. A forced deploy emails ADMIN_EMAILS first (a failed send refuses) and writes its record to
 * FORCED_OUT for the workflow to append to the ledger.
 *
 * Env: TRIGGER (auto|manual), SHA, CI_CONCLUSION, LEDGER_FILE, LEGACY_CI_GREEN (1|0), FORCE (true|false), REASON, ACTOR,
 *      DEPLOY_POLICY (provisional-ok|pass-required), RESEND_API_KEY, ADMIN_EMAILS, GITHUB_RUN_ID, GITHUB_REPOSITORY, FORCED_OUT
 */
import { existsSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { decideDeploy, sendForceEmail } from './deploy-decision.js';
import { forcedLine, parseDeployLedger } from './deploy-ledger.js';

async function main(): Promise<number> {
  const env = process.env;
  const file = env.LEDGER_FILE ?? '';
  const ledger = file && existsSync(file) ? parseDeployLedger(readFileSync(file, 'utf8')) : [];
  const decision = decideDeploy({
    trigger: env.TRIGGER === 'manual' ? 'manual' : 'auto',
    sha: env.SHA ?? '',
    ledger,
    policy: env.DEPLOY_POLICY === 'pass-required' ? 'pass-required' : 'provisional-ok',
    ciConclusion: env.CI_CONCLUSION,
    legacyCiGreen: env.LEGACY_CI_GREEN === '1',
    force: env.FORCE === 'true',
    reason: env.REASON,
    actor: env.ACTOR,
    now: new Date().toISOString(),
    runId: env.GITHUB_RUN_ID,
    emailConfigured: !!env.RESEND_API_KEY && !!env.ADMIN_EMAILS,
  });
  if (decision.allow && decision.forced) {
    try {
      await sendForceEmail(fetch, env.RESEND_API_KEY!, env.ADMIN_EMAILS!, decision.forced, env.GITHUB_REPOSITORY ?? '');
    } catch (err) {
      return report(false, `forced deploy refused: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (env.FORCED_OUT) writeFileSync(env.FORCED_OUT, forcedLine(decision.forced));
  }
  return report(decision.allow, decision.reason);
}

function report(allow: boolean, reason: string): number {
  const line = `${allow ? 'DEPLOY ALLOWED' : 'DEPLOY REFUSED'}: ${reason}`;
  console.log(`[deploy] ${line}`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### ${line}\n`);
  return allow ? 0 : 1;
}

main().then((code) => process.exit(code), (err: unknown) => {
  console.error(`[deploy] DEPLOY REFUSED: ${err instanceof Error ? err.message : String(err)} (failing closed)`);
  process.exit(1);
});
