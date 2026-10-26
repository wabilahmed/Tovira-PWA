import { describe, it, expect } from 'vitest';
import { parseCreateAdminArgs } from './create-admin.js';

/** [P45-1] create-admin arguments: --email is required; dry run unless --apply. (The create/refuse logic is
 *  AdminAuthService.createAdmin, tested in admin-auth-service.test.ts.) */
describe('[P45-1] create-admin args', () => {
  it('dry run by default; --apply applies', () => {
    expect(parseCreateAdminArgs(['--email', 'wabil@tovira.io'])).toEqual({ email: 'wabil@tovira.io', apply: false });
    expect(parseCreateAdminArgs(['--email', 'wabil@tovira.io', '--apply'])).toEqual({ email: 'wabil@tovira.io', apply: true });
  });
  it('NEGATIVE: no email, or an unknown argument, is refused', () => {
    expect(() => parseCreateAdminArgs([])).toThrow(/--email/);
    expect(() => parseCreateAdminArgs(['--email', 'a@b.io', '--force'])).toThrow(/unknown argument/);
  });
});
