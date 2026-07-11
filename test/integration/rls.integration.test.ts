import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// [P0-4] The isolation trust rules, proven against REAL Postgres RLS — not app
// code. We act as the non-superuser `tovira_app` role (via SET ROLE) exactly as
// the API does at runtime, set the tenant context, and assert the DB itself
// refuses to cross tenants. Docker-required.

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

/** Run SQL as the superuser; returns trimmed stdout. ON_ERROR_STOP makes SQL errors throw. */
function sql(statements: string): string {
  const escaped = statements.replace(/"/g, '\\"');
  return compose(`exec -T db psql -U tovira -d tovira -v ON_ERROR_STOP=1 -tAc "${escaped}"`, {
    capture: true,
  }).trim();
}

/**
 * Run SQL as the app role by dropping into tovira_app for the session. The
 * SET/SET ROLE utility commands echo their tag ("SET") ahead of the query
 * result, so we take the final output line — the SELECT's value.
 */
function asAppRole(userId: string | null, query: string): string {
  const setCtx = userId ? `SET app.user_id = '${userId}';` : '';
  const out = sql(`SET ROLE tovira_app; ${setCtx} ${query}`);
  const lines = out.split('\n').map((l) => l.trim()).filter(Boolean);
  return lines[lines.length - 1] ?? '';
}

let userA = '';
let userB = '';

describe('Postgres Row-Level Security enforces tenant isolation', () => {
  beforeAll(() => {
    compose('up -d --build --wait');
    // Seed two reps and one client each (as superuser — RLS is bypassed here).
    sql(
      `INSERT INTO users (email, password_hash) VALUES ('a@rls.test','x'),('b@rls.test','x')
       ON CONFLICT (email) DO NOTHING;`,
    );
    userA = sql(`SELECT id FROM users WHERE email='a@rls.test';`);
    userB = sql(`SELECT id FROM users WHERE email='b@rls.test';`);
    sql(
      `INSERT INTO clients (user_id, name) VALUES ('${userA}','A Secret Corp'),('${userB}','B Secret Corp');`,
    );
  }, 240_000);

  afterAll(() => {
    try {
      compose('down -v');
    } catch {
      /* best-effort */
    }
  });

  it('the app role is neither superuser nor BYPASSRLS', () => {
    // boolean||text renders as 'false'/'true' in Postgres.
    expect(sql(`SELECT rolsuper||'/'||rolbypassrls FROM pg_roles WHERE rolname='tovira_app';`)).toBe('false/false');
  });

  it('a rep sees only their own client (RLS filters without an app-side WHERE)', () => {
    expect(asAppRole(userA, `SELECT name FROM clients;`)).toBe('A Secret Corp');
    expect(asAppRole(userB, `SELECT name FROM clients;`)).toBe('B Secret Corp');
  });

  it('a raw query for another tenant\'s user_id returns ZERO rows', () => {
    expect(asAppRole(userA, `SELECT count(*) FROM clients WHERE user_id='${userB}';`)).toBe('0');
  });

  it('dropping the app-layer filter still isolates (count of ALL clients = own only)', () => {
    expect(asAppRole(userA, `SELECT count(*) FROM clients;`)).toBe('1');
  });

  it('is fail-closed: with no tenant context set, zero rows are visible', () => {
    expect(asAppRole(null, `SELECT count(*) FROM clients;`)).toBe('0');
  });

  it('refuses to write a row carrying another tenant\'s user_id (WITH CHECK)', () => {
    let threw = false;
    try {
      asAppRole(userA, `INSERT INTO clients (user_id, name) VALUES ('${userB}','sneaky');`);
    } catch (err) {
      threw = true;
      expect(String(err)).toMatch(/row-level security/i);
    }
    expect(threw).toBe(true);
    // And nothing was written.
    expect(sql(`SELECT count(*) FROM clients WHERE name='sneaky';`)).toBe('0');
  });
});
