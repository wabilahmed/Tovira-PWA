import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * [BETA-2b] Static guard on 0073 (access_requests + invites). These are PRE-TENANT tables — written
 * before any tenant/session context exists (the public form writes access_requests; an unauthenticated
 * visitor consumes an invite) — so, exactly like users/sessions/password_resets, they get NO tenant RLS
 * policy and are simply GRANTed to tovira_app. This asserts the migration DECLARES that shape; the
 * behavioural proof (the CHECK constraints actually reject bad rows) is in migrations-real-postgres.test.ts.
 */
const SQL = readFileSync(fileURLToPath(new URL('../../migrations/0073_access_requests_invites.sql', import.meta.url)), 'utf8');

describe('[BETA-2b] 0073 declares access_requests + invites', () => {
  for (const table of ['access_requests', 'invites']) {
    it(`${table}: created, granted to tovira_app, and NOT RLS-scoped (pre-tenant, like users)`, () => {
      expect(SQL).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
      expect(SQL).toMatch(new RegExp(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${table} TO tovira_app`));
      // Pre-tenant: must NOT enable RLS or declare a tenant policy on these tables.
      expect(SQL).not.toMatch(new RegExp(`ROW LEVEL SECURITY[\\s\\S]*${table}`));
      expect(SQL).not.toMatch(new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`));
      expect(SQL).not.toMatch(new RegExp(`CREATE POLICY [a-z_]+ ON ${table}`));
    });
  }

  it('status + ownership + conversation_ownership + expected_volume are constrained enums (text + CHECK)', () => {
    expect(SQL).toMatch(/status[\s\S]*CHECK \(status IN \('pending', ?'approved', ?'rejected', ?'invited', ?'activated'\)\)/);
    expect(SQL).toMatch(/CHECK \(ownership IN \('owns_or_manages', ?'employed'\)\)/);
    expect(SQL).toMatch(/CHECK \(conversation_ownership IN \('own_clients', ?'brokerage_i_manage', ?'brokerage_employs_me', ?'mix', ?'other'\)\)/);
    expect(SQL).toMatch(/CHECK \(expected_volume IN \('under_50', ?'50_200', ?'200_500', ?'500_plus'\)\)/);
  });

  it('declares the two defense-in-depth invariants (employed has no licence; other-text only when other)', () => {
    expect(SQL).toMatch(/CHECK \(ownership <> 'employed' OR trade_licence_number IS NULL\)/);
    expect(SQL).toMatch(/CHECK \(conversation_ownership = 'other' OR conversation_ownership_other IS NULL\)/);
  });

  it('invites is a structural copy of password_resets: token_hash PK, consumed_at, FKs, no id column', () => {
    expect(SQL).toMatch(/token_hash\s+text PRIMARY KEY/);
    expect(SQL).toMatch(/consumed_at\s+timestamptz/);
    expect(SQL).toMatch(/access_request_id uuid NOT NULL REFERENCES access_requests\(id\)/);
    expect(SQL).toMatch(/user_id +uuid NOT NULL REFERENCES users\(id\)/);
    // Following the password_resets precedent exactly: the hashed token IS the key — no separate id.
    expect(SQL).not.toMatch(/CREATE TABLE IF NOT EXISTS invites \([\s\S]*?\bid uuid/);
  });

  it('no native enum types — matches the repo convention of text + CHECK', () => {
    expect(SQL).not.toMatch(/CREATE TYPE/i);
  });
});
