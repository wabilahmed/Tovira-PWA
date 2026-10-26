import type { TestDeps } from '../http/test-deps.js';
import { TEST_ADMIN_EMAIL } from '../http/test-deps.js';
import { totpCode } from '../services/admin/totp.js';

/** [P45] Test helper: create the configured admin, set a password and enrol 2FA over HTTP. Returns the cookie of a
 *  fully signed-in session, the TOTP secret and the recovery codes. */
export async function signInAdmin(base: string, deps: TestDeps, opts: { enrol?: boolean } = {}): Promise<{ cookie: string; token: string; secret: string | null; recoveryCodes: string[] }> {
  await deps.adminAuth.createAdmin(TEST_ADMIN_EMAIL, { apply: true });
  const mail = deps.emailSender.sent.filter((m) => m.to === TEST_ADMIN_EMAIL).at(-1)!;
  const invite = /set-password\?token=([A-Za-z0-9_-]+)/.exec(mail.text)![1]!;
  const r = await fetch(`${base}/admin/auth/set-password`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: invite, password: 'a long admin passphrase' }) });
  const token = /admin_session=([^;]*)/.exec(r.headers.get('set-cookie') ?? '')![1]!;
  const cookie = `admin_session=${token}`;
  if (opts.enrol === false) return { cookie, token, secret: null, recoveryCodes: [] };
  const H = { 'content-type': 'application/json', cookie };
  const { secret } = (await (await fetch(`${base}/admin/auth/enrol/start`, { method: 'POST', headers: H, body: '{}' })).json()) as { secret: string };
  const { recoveryCodes } = (await (await fetch(`${base}/admin/auth/enrol/confirm`, { method: 'POST', headers: H, body: JSON.stringify({ code: totpCode(secret, Date.now()) }) })).json()) as { recoveryCodes: string[] };
  return { cookie, token, secret, recoveryCodes };
}
