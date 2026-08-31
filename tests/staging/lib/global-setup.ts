/**
 * Vitest globalSetup — the front door. Resolves + validates the staging target
 * (rail #1: refuse to run against an unset or production target), prints the target
 * host banner so every run states where it is pointed, does a health probe, and
 * truncates the run's results file so Task C reads only this run.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { resolveTarget } from './env.js';
import { RESULTS_FILE } from './report.js';

export default async function setup(): Promise<() => void> {
  let target;
  try {
    target = resolveTarget();
  } catch (err) {
    // Hard refusal — print clearly and abort the whole run.
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\n⛔ STAGING HARNESS REFUSED TO RUN\n   ${msg}\n`);
    throw err;
  }

  // Fresh results file for this run.
  mkdirSync(dirname(RESULTS_FILE), { recursive: true });
  writeFileSync(RESULTS_FILE, '');

  const banner = [
    '',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '  TOVIRA STAGING TEST HARNESS',
    `  API : ${target.apiBase}   (host: ${target.apiHost})`,
    `  APP : ${target.appBase}   (host: ${target.appHost})`,
    `  results → ${RESULTS_FILE}`,
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '',
  ].join('\n');
  console.log(banner);

  // Health probe (non-fatal — a red health is itself a finding the suites record).
  try {
    const res = await fetch(`${target.apiBase}/health`, { method: 'GET' });
    console.log(`  health: /api/health → ${res.status}`);
  } catch (err) {
    console.warn(`  health probe failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  return () => {
    console.log('\n  staging run complete — see STAGING-TEST-REPORT.md after Task C.\n');
  };
}
