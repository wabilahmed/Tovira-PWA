import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { loadConfig } from './config.js';
import { createPool } from './db/pool.js';
import { loadMigrations, runMigrations } from './db/migrate.js';
import { createApiServer } from './server.js';
import { createAuthService } from './container.js';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, '..', 'migrations');

async function main(): Promise<void> {
  // Fail fast on bad config BEFORE opening any connection or port.
  const config = loadConfig();

  const pool = createPool(config.databaseUrl);

  // Apply migrations on boot. A failure here aborts startup (see MigrationError).
  const client = await pool.connect();
  try {
    const { applied } = await runMigrations(client, loadMigrations(migrationsDir));
    if (applied.length > 0) {
      console.log(`[migrate] applied ${applied.length} migration(s): ${applied.join(', ')}`);
    } else {
      console.log('[migrate] schema up to date');
    }
  } finally {
    client.release();
  }

  const auth = createAuthService(config, pool);
  const server = createApiServer({ pool, auth, cookieSecure: config.nodeEnv === 'production' });
  server.listen(config.port, () => {
    console.log(`[api] listening on http://0.0.0.0:${config.port} (${config.nodeEnv})`);
  });

  const shutdown = () => {
    server.close(() => {
      void pool.end().then(() => process.exit(0));
    });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err: unknown) => {
  // Named, actionable failure — never a silent half-up state.
  console.error(`[api] fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
