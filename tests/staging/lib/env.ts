/**
 * Target resolution + the safety guard (rail #1). The harness runs ONLY against a
 * staging server: the base URLs come from STAGING_API_URL / STAGING_APP_URL, and we
 * hard-refuse if either is unset or points at a production hostname. Imported by the
 * global setup (which prints the target and aborts the run) and by the HTTP client.
 */

export interface Target {
  apiBase: string; // e.g. https://staging.tovira.io/api
  appBase: string; // e.g. https://staging.tovira.io
  apiHost: string;
  appHost: string;
}

// Hostnames we must NEVER touch. Apex + www + app + api on the real domains.
const PRODUCTION_HOST = /^(www\.|app\.|api\.)?tovira\.(io|com)$/i;

function isProductionHost(host: string): boolean {
  // staging.tovira.io is allowed; app/api/www/apex tovira.io|com are not.
  if (/^staging\./i.test(host)) return false;
  return PRODUCTION_HOST.test(host);
}

function requireUrl(name: string, value: string | undefined): URL {
  if (!value || !value.trim()) {
    throw new StagingGuardError(
      `${name} is unset. The staging harness refuses to run without an explicit staging target. ` +
        `Set STAGING_API_URL and STAGING_APP_URL (e.g. https://staging.tovira.io/api and https://staging.tovira.io).`,
    );
  }
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new StagingGuardError(`${name} is not a valid URL: "${value}".`);
  }
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    throw new StagingGuardError(`${name} must be https (got ${url.protocol}//). Refusing to run.`);
  }
  if (isProductionHost(url.hostname)) {
    throw new StagingGuardError(
      `${name} points at a PRODUCTION host (${url.hostname}). The harness refuses to run against production. ` +
        `Point it at staging (e.g. https://staging.tovira.io).`,
    );
  }
  return url;
}

export class StagingGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StagingGuardError';
  }
}

/** Resolve + validate the staging target, or throw StagingGuardError. */
export function resolveTarget(env: NodeJS.ProcessEnv = process.env): Target {
  const api = requireUrl('STAGING_API_URL', env.STAGING_API_URL);
  const app = requireUrl('STAGING_APP_URL', env.STAGING_APP_URL);
  // Normalise: strip a trailing slash so we can join paths cleanly.
  const apiBase = api.toString().replace(/\/$/, '');
  const appBase = app.toString().replace(/\/$/, '');
  return { apiBase, appBase, apiHost: api.hostname, appHost: app.hostname };
}

/** A unique, namespaced run id so every account/email we create is ours alone. */
export function newRunId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** The namespaced email domain for QA identities (rail #3/#5 — never a real inbox). */
export function qaEmailDomain(env: NodeJS.ProcessEnv = process.env): string {
  return (env.QA_EMAIL_DOMAIN && env.QA_EMAIL_DOMAIN.trim()) || 'qa.tovira.io';
}
