import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { loadConfig } from '../config.js';
import { createPool } from '../db/pool.js';
import { loadMigrations, runMigrations } from '../db/migrate.js';
import { seedDatabase } from './seed.js';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, '..', '..', 'migrations');

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = createPool(config.databaseUrl); // owner/superuser — bypasses RLS to seed.
  try {
    // Ensure the schema exists so `npm run seed` works on a bare database.
    const client = await pool.connect();
    try {
      await runMigrations(client, loadMigrations(migrationsDir));
    } finally {
      client.release();
    }

    const summary = await seedDatabase(pool);
    console.log(
      `[seed] done: ${summary.clients} clients, ${summary.notes} notes for ${summary.userEmail}`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error(`[seed] failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
