import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parse } from 'yaml';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

interface ComposeService {
  image?: string;
  build?: unknown;
  command?: string | string[];
  ports?: string[];
  environment?: Record<string, string> | string[];
  volumes?: string[];
  healthcheck?: { test?: unknown };
  depends_on?: Record<string, { condition?: string }> | string[];
}
interface Compose {
  services: Record<string, ComposeService>;
  volumes?: Record<string, unknown>;
}

const compose = parse(readFileSync(resolve(root, 'docker-compose.yml'), 'utf8')) as Compose;

function envString(svc: ComposeService): string {
  const e = svc.environment;
  if (!e) return '';
  return Array.isArray(e) ? e.join('\n') : Object.entries(e).map(([k, v]) => `${k}=${v}`).join('\n');
}

// [P0-1] The single command must bring up three healthy services with pgvector,
// a persistent named volume, and hot reload — encoded here so a regression to the
// compose file fails the build.
describe('docker-compose.yml', () => {
  it('defines the three services: db, api, web', () => {
    expect(Object.keys(compose.services).sort()).toEqual(['api', 'db', 'web']);
  });

  it('uses a pgvector-enabled Postgres image', () => {
    expect(compose.services.db!.image ?? '').toMatch(/pgvector/i);
  });

  it('every service has a healthcheck so "up" means healthy', () => {
    for (const name of ['db', 'api', 'web']) {
      expect(compose.services[name]!.healthcheck?.test, `${name} healthcheck`).toBeTruthy();
    }
  });

  it('api waits for the db to be healthy before starting', () => {
    const dep = compose.services.api!.depends_on;
    expect(dep && !Array.isArray(dep) ? dep.db?.condition : undefined).toBe('service_healthy');
  });

  it('persists Postgres data in a declared named volume (survives restart)', () => {
    const dbVolumes = compose.services.db!.volumes ?? [];
    const dataMount = dbVolumes.find((v) => v.includes('/var/lib/postgresql/data'));
    expect(dataMount, 'db must mount a volume at the postgres data dir').toBeTruthy();
    const volName = dataMount!.split(':')[0]!;
    expect(compose.volumes?.[volName], `named volume "${volName}" must be declared`).toBeDefined();
  });

  it('mounts source into api and web for hot reload', () => {
    expect((compose.services.api!.volumes ?? []).some((v) => v.startsWith('./apps/api'))).toBe(true);
    expect((compose.services.web!.volumes ?? []).some((v) => v.startsWith('./apps/web'))).toBe(true);
  });

  it('exposes api and web ports to the host', () => {
    expect((compose.services.api!.ports ?? []).length).toBeGreaterThan(0);
    expect((compose.services.web!.ports ?? []).length).toBeGreaterThan(0);
  });

  // "no manual steps" — every referenced env var must carry an inline default so
  // a clean checkout comes up without the developer first authoring a .env.
  it('provides in-compose defaults so a clean checkout needs no .env', () => {
    const dbEnv = envString(compose.services.db!);
    expect(dbEnv).toMatch(/POSTGRES_/);
    // Interpolated vars must use the ${VAR:-default} form (contains ":-").
    const interpolations = dbEnv.match(/\$\{[^}]+\}/g) ?? [];
    for (const token of interpolations) {
      expect(token, `${token} must supply a default`).toContain(':-');
    }
  });
});
