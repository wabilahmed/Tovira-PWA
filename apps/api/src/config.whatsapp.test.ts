import { describe, it, expect } from 'vitest';
import { loadConfig, assertDeployReady } from './config.js';

// [P72-1 · owner] The WhatsApp settings come through the normal config and its boot audit.
describe('[P72-1] WhatsApp in the app config', () => {
  const base = { DATABASE_URL: 'postgres://tovira:tovira@localhost:5432/tovira' };
  const ready = (env: Record<string, string | undefined>) => () => assertDeployReady(loadConfig(env), env);
  it('loadConfig carries the WhatsApp settings; off and test by default', () => {
    const c = loadConfig({ ...base, WHATSAPP_VERIFY_TOKEN: 'v' });
    expect(c.whatsapp.enabled).toBe(false);
    expect(c.whatsapp.mode).toBe('test');
    expect(c.whatsapp.verifyToken).toBe('v');
  });
  it('a local config with no WhatsApp keys still boots', () => {
    expect(ready(base)).not.toThrow();
  });
  it('NEGATIVE: a bad WHATSAPP_MODE stops the boot, naming it', () => {
    expect(ready({ ...base, WHATSAPP_MODE: 'live' })).toThrow(/WHATSAPP_MODE \(must be "test" or "real", got "live"\)/);
  });
  it('NEGATIVE: ingest switched on without its keys stops the boot, naming each', () => {
    const check = ready({ ...base, WHATSAPP_INGEST_ENABLED: 'true' });
    expect(check).toThrow(/WHATSAPP_ACCESS_TOKEN/);
    expect(check).toThrow(/WHATSAPP_TEST_NUMBER_ID/);
  });
});
