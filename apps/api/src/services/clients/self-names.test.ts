import { describe, it, expect } from 'vitest';
import { clientSelfNames, isTheClient } from './self-names.js';

/**
 * [P36-5 · owner, 20 Oct] An alias hides a person from People / the stakeholder map ONLY when the client is an
 * individual (then the alias is the same person). For a company client a person whose name is an alias is a
 * real stakeholder — never hidden. When the type isn't known, don't guess: show the person. The client's own
 * name always marks the client.
 */
describe('[P36-5] who counts as the client', () => {
  it('a company client with alias "Khalid" → Khalid is shown', () => {
    const self = clientSelfNames('Marina Estates', ['Khalid'], 'company');
    expect(isTheClient('Khalid', self)).toBe(false);
    expect(isTheClient('Marina Estates', self)).toBe(true);
  });

  it('an individual client "QA Windowed Buyer 2" with alias "Windowed Buyer" → hidden', () => {
    const self = clientSelfNames('QA Windowed Buyer 2', ['Windowed Buyer'], 'individual');
    expect(isTheClient('Windowed Buyer', self)).toBe(true);
    expect(isTheClient('QA Windowed Buyer 2', self)).toBe(true);
  });

  it('unknown type → the alias person is shown (no guessing); the client name still marks the client', () => {
    for (const type of [undefined, null] as const) {
      const self = clientSelfNames('QA Windowed Buyer 2', ['Windowed Buyer'], type);
      expect(isTheClient('Windowed Buyer', self)).toBe(false);
      expect(isTheClient('QA Windowed Buyer 2', self)).toBe(true);
    }
  });
});
