import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// [P14-0 guard] Every path that makes a rep account USABLE must start the 14-day trial via the shared
// onSignup hook — otherwise the account lands unentitled (no subscription row → the no-row default
// {status:'none', billingState:'active', entitled:false}). This fails if a new account-usable creator
// (auth.signup / auth.acceptInvite) is added without a matching opts.onSignup call in the same file.
describe('[P14-0] every account-usable creation path starts the trial', () => {
  it('auth-routes.ts fires onSignup for every account-usable creator', () => {
    const src = readFileSync(resolve(process.cwd(), 'apps/api/src/http/auth-routes.ts'), 'utf8');
    const creators = (src.match(/auth\.(signup|acceptInvite)\(/g) ?? []).length;
    const trialStarts = (src.match(/opts\.onSignup\?\.\(/g) ?? []).length;
    expect(creators).toBeGreaterThanOrEqual(2); // signup + accept-invite (sanity: the patterns still exist)
    expect(trialStarts).toBeGreaterThanOrEqual(creators);
  });
});
