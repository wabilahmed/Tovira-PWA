import { describe, it, expect } from 'vitest';
import { loadConfig, emailConfigSummary } from './config.js';

// [P22-3] What every email will actually use — the provider, the From, the Reply-To and the origin of
// every link — derived from config only (no secret values: these appear in every email anyway).
describe('[P22-3] emailConfigSummary', () => {
  it('reports provider, sender, reply-to and the link origin from env', () => {
    const cfg = loadConfig({ DATABASE_URL: 'postgres://x', EMAIL_SENDER: 'resend', EMAIL_FROM: 'Tovira <hello@tovira.io>', APP_BASE_URL: 'https://staging.tovira.io/' });
    expect(emailConfigSummary(cfg)).toEqual({ provider: 'resend', from: 'Tovira <hello@tovira.io>', replyTo: 'hello@tovira.io', appOrigin: 'https://staging.tovira.io' });
  });
  it('says so plainly when the sender is unset (local / stub)', () => {
    expect(emailConfigSummary(loadConfig({ DATABASE_URL: 'postgres://x' })).from).toBe('(unset)');
  });
});
