import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// [P42-A6] Owner: a required Industry on new beta requests, to see which segments sign up. Additive and
// nullable: requests made before it show "Not given". The DB holds the same choices the API validates.
const SQL = readFileSync(fileURLToPath(new URL('../../migrations/0095_access_request_industry.sql', import.meta.url)), 'utf8');

describe('[P42-A6] 0095 adds industry to access_requests', () => {
  it('adds a nullable industry constrained to the seven choices', () => {
    expect(SQL).toMatch(/ALTER TABLE access_requests[\s\S]*ADD COLUMN IF NOT EXISTS industry text/);
    expect(SQL).toMatch(/CHECK \(industry IS NULL OR industry IN \('insurance', ?'wealth_private_banking', ?'b2b_key_accounts', ?'luxury_client_advisory', ?'recruitment', ?'property', ?'other'\)\)/);
    expect(SQL).not.toMatch(/industry text NOT NULL/i);
  });
  it('adds industry_other, allowed only with "other" (defence in depth, like conversation_ownership_other)', () => {
    expect(SQL).toMatch(/ADD COLUMN IF NOT EXISTS industry_other text/);
    expect(SQL).toMatch(/CHECK \(industry = 'other' OR industry_other IS NULL\)/);
  });
  it('NEGATIVE: no backfill guesses an industry for existing requests, and no RLS on this pre-tenant table', () => {
    expect(SQL).not.toMatch(/UPDATE access_requests/i);
    expect(SQL).not.toMatch(/ROW LEVEL SECURITY|CREATE POLICY/i);
  });
});
