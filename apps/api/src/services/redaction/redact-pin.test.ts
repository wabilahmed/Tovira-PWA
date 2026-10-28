import { describe, it, expect } from 'vitest';
import { redactSensitive } from './redact.js';

const blanked = (t: string) => redactSensitive(t).redacted;
const untouched = (t: string) => expect(redactSensitive(t).redacted, t).toBe(t);

// [P53 · owner] "PIN" is two different things. A postal PIN code is not a secret: "PIN code", "pincode" and "पिन कोड" are
// kept (and the word "code" is no longer mangled). A bare "PIN" followed by digits stays a secret PIN and is blanked:
// leaking a real PIN is worse than hiding a postal code.
describe('[P53-0] PIN codes are not secret PINs', () => {
  it('NEGATIVE: "PIN code 560001" is kept', () => untouched('PIN code 560001'));
  it('NEGATIVE: "pincode 560001" is kept', () => untouched('pincode 560001'));
  it('NEGATIVE: "पिन कोड 560001" is kept', () => untouched('पिन कोड 560001'));
  it('"PIN 560001" is blanked (a bare PIN is a secret)', () => expect(blanked('PIN 560001')).toBe('PIN [credential redacted]'));
  it('"my ATM PIN is 4821" is blanked', () => expect(blanked('my ATM PIN is 4821')).toBe('my ATM PIN is [credential redacted]'));
});
