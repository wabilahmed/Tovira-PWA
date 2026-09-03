import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * [INV-DATA] Static guard on 0041: the isolation must be at the DB, not the handler. The
 * SQL itself validates on boot (Docker/CI); this asserts the schema DECLARES the net — RLS
 * FORCE on both tables, and the composite FKs that make a cross-tenant reference a DB error
 * (the 0036 IDOR doctrine applied at design time). A refactor that drops one fails here.
 */
const SQL = readFileSync(fileURLToPath(new URL('../../migrations/0041_inventory.sql', import.meta.url)), 'utf8');

describe('[INV-DATA] 0041 declares DB-level isolation', () => {
  for (const table of ['inventory_items', 'inventory_shares']) {
    it(`${table}: RLS enabled + FORCED + tenant policy + granted to tovira_app`, () => {
      expect(SQL).toMatch(new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`));
      expect(SQL).toMatch(new RegExp(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`));
      expect(SQL).toMatch(new RegExp(`CREATE POLICY ${table}_tenant_isolation ON ${table}`));
      expect(SQL).toMatch(new RegExp(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${table} TO tovira_app`));
    });
  }

  it('the tenant policy uses the app.user_id session setting (same expression as every table)', () => {
    expect(SQL).toMatch(/user_id = current_setting\('app\.user_id', true\)::uuid/);
  });

  it('inventory_shares uses COMPOSITE foreign keys — a cross-tenant reference is a DB error', () => {
    expect(SQL).toMatch(/FOREIGN KEY \(user_id, item_id\) REFERENCES inventory_items\(user_id, id\)/);
    expect(SQL).toMatch(/FOREIGN KEY \(user_id, client_id\) REFERENCES clients\(user_id, id\)/);
    // the referenced composite key must exist on inventory_items
    expect(SQL).toMatch(/UNIQUE \(user_id, id\)/);
  });

  it('never deletes: no item-level DELETE/DROP TABLE hidden in the migration (only account CASCADE)', () => {
    // The only ON DELETE CASCADE is the users FK (account deletion); no manual data drop.
    expect(SQL).not.toMatch(/DROP TABLE/i);
  });
});
