import { describe, it, expect, beforeEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// [P17] Drive scripts/ops/run-backfill.sh with a MOCKED aws CLI (a fake `aws` on PATH) — no real AWS.
// Asserts the argument handling, the --apply guard, and that the ECS run-task picks up the prod
// task-def + network values the mocked describe-services returns.
const SCRIPT = join(__dirname, '..', 'scripts', 'ops', 'run-backfill.sh');

// A fake `aws` that records every invocation and returns canned JSON per subcommand. describe-services
// returns the SAME shape the script's --query projects: {taskDefinition, net:{subnets,securityGroups,assignPublicIp}}.
const FAKE_AWS = `#!/usr/bin/env bash
echo "$@" >> "$AWS_CALLS_LOG"
case "$1 $2" in
  "ecs describe-services") echo '{"taskDefinition":"arn:aws:ecs:eu-north-1:862070608699:task-definition/tovira-prod-api:95","net":{"subnets":["subnet-0d1a13d3bd0d721c1","subnet-010bd2b57cddd75f0"],"securityGroups":["sg-0716dafb8b38b65d8"],"assignPublicIp":"ENABLED"}}' ;;
  "ecs run-task") echo '{"tasks":[{"taskArn":"arn:aws:ecs:eu-north-1:862070608699:task/tovira-prod/abc123taskid"}]}' ;;
  "ecs wait") exit 0 ;;
  "ecs describe-tasks") echo '{"reason":"Essential container in task exited","exit":0}' ;;
  "logs get-log-events") echo '{"events":[{"message":"[backfill-trials] DRY RUN — no writes."}]}' ;;
  *) echo '{}' ;;
esac
`;

let dir: string, binDir: string, stateDir: string, callsLog: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rb-'));
  binDir = join(dir, 'bin');
  stateDir = join(dir, 'state');
  callsLog = join(dir, 'aws-calls.log');
  mkdirSync(binDir, { recursive: true });
  writeFileSync(callsLog, '');
  writeFileSync(join(binDir, 'aws'), FAKE_AWS);
  chmodSync(join(binDir, 'aws'), 0o755);
});

function run(args: string[]): { status: number; stdout: string; stderr: string; calls: string } {
  const r = spawnSync('bash', [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${binDir}:${process.env.PATH ?? ''}`, AWS_CALLS_LOG: callsLog, TOVIRA_BACKFILL_STATE_DIR: stateDir },
  });
  return { status: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '', calls: readFileSync(callsLog, 'utf8') };
}
// The LAST run-task line — calls.log accumulates across runs within a test (e.g. dry run then apply).
const runTaskLine = (calls: string): string => calls.split('\n').filter((l) => l.startsWith('ecs run-task')).at(-1) ?? '';

describe('[P17] run-backfill.sh — arg handling', () => {
  it('dry run (no --apply): runs the task with the backfill command + --only, and NOT --apply', () => {
    const r = run(['--only', 'U1']);
    expect(r.status).toBe(0);
    const line = runTaskLine(r.calls);
    expect(line).toContain('backfill-trials.ts');
    expect(line).toContain('--only');
    expect(line).toContain('U1');
    expect(line).not.toContain('--apply');
    // a successful dry run is recorded for the --apply guard
    expect(readdirSync(stateDir).length).toBeGreaterThan(0);
  });

  it('passes --apply through to the container when applying', () => {
    const r = run(['--only', 'U1', '--apply', '--i-checked-the-dry-run']);
    expect(r.status).toBe(0);
    expect(runTaskLine(r.calls)).toContain('--apply');
  });

  it('the run-task picks up the prod task-def + subnets + security groups + assignPublicIp from the service', () => {
    const line = runTaskLine(run(['--only', 'U1']).calls);
    expect(line).toContain('tovira-prod-api:95');                 // current task definition
    expect(line).toContain('subnet-0d1a13d3bd0d721c1');           // service subnet
    expect(line).toContain('sg-0716dafb8b38b65d8');               // service security group
    expect(line).toContain('assignPublicIp=ENABLED');             // mirrors the service
    expect(line).toContain('launch-type FARGATE');
  });

  it('prints the task log and exits with the task exit code', () => {
    const r = run(['--only', 'U1']);
    expect(r.stdout).toContain('[backfill-trials] DRY RUN — no writes.');
    expect(r.status).toBe(0);
  });
});

describe('[P17] run-backfill.sh — the --apply guard', () => {
  it('REFUSES --apply with no prior dry run, and makes NO run-task call', () => {
    const r = run(['--only', 'U2', '--apply']);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/no successful dry run/i);
    expect(runTaskLine(r.calls)).toBe(''); // never reached the AWS calls
  });

  it('ALLOWS --apply with --i-checked-the-dry-run (override)', () => {
    const r = run(['--only', 'U2', '--apply', '--i-checked-the-dry-run']);
    expect(r.status).toBe(0);
    expect(runTaskLine(r.calls)).toContain('--apply');
  });

  it('ALLOWS --apply after a successful dry run for the SAME args (within the TTL)', () => {
    expect(run(['--only', 'U3']).status).toBe(0);        // dry run records the stamp
    const r = run(['--only', 'U3', '--apply']);           // same args → authorised
    expect(r.status).toBe(0);
    expect(runTaskLine(r.calls)).toContain('--apply');
  });

  it('a dry run for DIFFERENT args does NOT authorise --apply', () => {
    expect(run(['--only', 'U3']).status).toBe(0);         // dry run for U3
    const r = run(['--only', 'U4', '--apply']);           // different account → still refused
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/no successful dry run/i);
  });

  it('refuses --apply when the dry-run stamp is older than the TTL', () => {
    expect(run(['--only', 'U3']).status).toBe(0);           // dry run writes the stamp
    // Age the stamp well past the default 30m TTL (deterministic — no sleeping).
    const stamp = join(stateDir, readdirSync(stateDir).find((f) => f.endsWith('.dryrun'))!);
    writeFileSync(stamp, String(Math.floor(Date.now() / 1000) - 10_000));
    const r = run(['--only', 'U3', '--apply']);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/old|dry run/i);
  });
});

describe('[P17] run-backfill.sh — validation', () => {
  it('rejects an unknown argument', () => {
    const r = run(['--nope']);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/unknown argument/i);
  });
  it('rejects --only with no value', () => {
    const r = run(['--only']);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/--only needs a userId/i);
  });
});

describe('[P21-C] run-backfill.sh — choosing the backfill', () => {
  it('--script promise-dates runs backfill-promise-dates.ts with --only-user', () => {
    const r = run(['--script', 'promise-dates', '--only-user', 'U1']);
    expect(r.status).toBe(0);
    const line = runTaskLine(r.calls);
    expect(line).toContain('backfill-promise-dates.ts');
    expect(line).toContain('--only-user');
    expect(line).toContain('U1');
    expect(line).not.toContain('--script'); // consumed by the runner, never sent to the container
    expect(line).not.toContain('--apply');
  });

  // [P45] create-admin: dry run first (the shared guard), --email passed through
  it('--script create-admin --email runs create-admin.ts as a dry run, and --apply needs that dry run first', () => {
    const refused = run(['--script', 'create-admin', '--email', 'wabil@tovira.io', '--apply']);
    expect(refused.status).not.toBe(0);
    expect(runTaskLine(refused.calls)).toBe('');
    const line = runTaskLine(run(['--script', 'create-admin', '--email', 'wabil@tovira.io']).calls);
    expect(line).toContain('create-admin.ts');
    expect(line).toContain('wabil@tovira.io');
    expect(line).not.toContain('--apply');
  });

  // [P44-3] the subscription-periods audit is READ-ONLY: it runs without --apply, and --apply is refused
  it('--script subscription-periods runs the read-only audit and refuses --apply', () => {
    const r = run(['--script', 'subscription-periods', '--apply']); // refused before any AWS call
    expect(r.status).not.toBe(0);
    expect(runTaskLine(r.calls)).toBe('');
    expect(runTaskLine(run(['--script', 'subscription-periods']).calls)).toContain('audit-subscription-periods.ts');
  });

  // [P43] the undated-to-confirm backfill, dry-run first like the others
  it('--script undated-to-confirm runs backfill-undated-to-confirm.ts (dry run by default)', () => {
    const r = run(['--script', 'undated-to-confirm']);
    expect(runTaskLine(r.calls)).toContain('backfill-undated-to-confirm.ts');
    expect(runTaskLine(r.calls)).not.toContain('--apply');
  });

  it('--script meeting-dates runs backfill-meeting-dates.ts', () => {
    expect(runTaskLine(run(['--script', 'meeting-dates', '--only-user', 'U1']).calls)).toContain('backfill-meeting-dates.ts');
  });

  it('defaults to the trial backfill (unchanged)', () => {
    expect(runTaskLine(run(['--only', 'U1']).calls)).toContain('backfill-trials.ts');
  });

  it('REFUSES an unknown script name with no AWS call', () => {
    const r = run(['--script', 'drop-everything']);
    expect(r.status).toBe(2);
    expect(runTaskLine(r.calls)).toBe('');
  });

  it('a dry run of one backfill does NOT authorise --apply of another', () => {
    expect(run(['--script', 'promise-dates', '--only-user', 'U5']).status).toBe(0);
    const r = run(['--script', 'meeting-dates', '--only-user', 'U5', '--apply']);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/no successful dry run/i);
  });
});

// [P42 · fix(P40-5)] Under `set -o pipefail`, `printf … | grep -q` can fail when grep exits on its first match
// and printf takes SIGPIPE: the pipeline then reads as "no match". That made qa-data-audit --ids --apply refuse
// with "add --ids" intermittently under load. No ops script may pipe into `grep -q` while pipefail is on.
describe('[P42] ops scripts never pipe into grep -q under pipefail', () => {
  it('scripts/ops/*.sh with pipefail have no "| grep -q"', () => {
    const opsDir = join(__dirname, '..', 'scripts', 'ops');
    for (const f of readdirSync(opsDir).filter((n) => n.endsWith('.sh'))) {
      const src = readFileSync(join(opsDir, f), 'utf8');
      if (!/pipefail/.test(src)) continue;
      const offenders = src.split('\n').filter((l) => !l.trim().startsWith('#') && /\|\s*grep\s+-[a-zA-Z]*q/.test(l));
      expect(offenders, f).toEqual([]);
    }
  });
});
