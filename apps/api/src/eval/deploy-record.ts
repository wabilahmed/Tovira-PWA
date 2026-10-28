/**
 * [P52] CI's last job: print a ci_green record for this commit (every CI job passed), for scripts/ops/append-fab-ledger.sh
 * to append to deploy-ledger.jsonl on the gate-ledger branch. Usage: npx tsx apps/api/src/eval/deploy-record.ts ci-green
 */
import { ciGreenLine } from './deploy-ledger.js';

const [, , kind] = process.argv;
const sha = process.env.GITHUB_SHA;
const runId = process.env.GITHUB_RUN_ID;
if (kind !== 'ci-green' || !sha || !runId) {
  console.error('usage: deploy-record.ts ci-green (needs GITHUB_SHA and GITHUB_RUN_ID)');
  process.exit(1);
}
process.stdout.write(ciGreenLine({ type: 'ci_green', sha, runId, at: new Date().toISOString() }));
