import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// [P0-1] End-to-end proof that ONE command brings up a healthy stack with
// pgvector, and that data survives a restart via the named volume.
// Docker-required — run with `npm run test:integration`, not the default suite.

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');

function compose(args: string, opts: { capture?: boolean } = {}): string {
  return execSync(`docker compose ${args}`, {
    cwd: root,
    stdio: opts.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    encoding: 'utf8',
    timeout: 220_000,
  });
}

function psql(sql: string): string {
  // -T avoids TTY allocation in CI.
  return compose(
    `exec -T db psql -U tovira -d tovira -tAc "${sql.replace(/"/g, '\\"')}"`,
    { capture: true },
  ).trim();
}

describe('one-command local stack', () => {
  beforeAll(() => {
    // --wait blocks until every service with a healthcheck reports healthy.
    compose('up -d --build --wait');
  }, 240_000);

  afterAll(() => {
    try {
      compose('down -v');
    } catch {
      /* best-effort teardown */
    }
  });

  it('has the pgvector extension installed', () => {
    const rows = psql("SELECT extname FROM pg_extension WHERE extname='vector'");
    expect(rows).toBe('vector');
  });

  it('persists data across a full stack restart (named volume)', () => {
    psql('CREATE TABLE IF NOT EXISTS _persist_check (id int)');
    psql('INSERT INTO _persist_check (id) VALUES (42)');

    // down (without -v keeps the named volume) then back up.
    compose('down');
    compose('up -d --wait');

    const value = psql('SELECT id FROM _persist_check ORDER BY id LIMIT 1');
    expect(value).toBe('42');
  });
});
