import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { fixtures } from '../../apps/api/src/seed/fixtures.js';

// [P0-6] The seed command loads realistic fixtures and is idempotent — proven
// against the real stack (seed runs inside the api container). Docker-required.

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const env = { ...process.env, DB_PORT: '0', API_PORT: '0', WEB_PORT: '0' };

function compose(args: string, opts: { capture?: boolean } = {}): string {
  return execSync(`docker compose ${args}`, {
    cwd: root,
    stdio: opts.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    encoding: 'utf8',
    timeout: 220_000,
    env,
  });
}

function count(table: string): number {
  const out = compose(`exec -T db psql -U tovira -d tovira -tAc "SELECT count(*) FROM ${table}"`, {
    capture: true,
  }).trim();
  return Number(out);
}

describe('seed command', () => {
  beforeAll(() => {
    compose('up -d --build --wait');
  }, 240_000);

  afterAll(() => {
    try {
      compose('down -v');
    } catch {
      /* best-effort */
    }
  });

  it('loads realistic clients and notes with extracted facts', () => {
    compose('exec -T api npm run seed');
    expect(count('clients')).toBe(fixtures.clients.length);
    expect(count('notes')).toBe(fixtures.notes.length);
    expect(count("notes WHERE extracted IS NOT NULL")).toBe(fixtures.notes.length);
    // The demo user exists so a developer can log in and see the data.
    expect(count(`users WHERE email='${fixtures.user.email}'`)).toBe(1);
  });

  // NEGATIVE: running twice must not duplicate or corrupt data.
  it('is idempotent: a second run leaves counts unchanged', () => {
    compose('exec -T api npm run seed');
    compose('exec -T api npm run seed');
    expect(count('clients')).toBe(fixtures.clients.length);
    expect(count('notes')).toBe(fixtures.notes.length);
    expect(count(`users WHERE email='${fixtures.user.email}'`)).toBe(1);
  });
});
