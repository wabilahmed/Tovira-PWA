import { describe, it, expect } from 'vitest';
import { normalizeTrialEmailKey } from './trial-email-key.js';

describe('[TRIAL-FARM] normalizeTrialEmailKey', () => {
  it('strips plus-addressing for any provider (same inbox → same key)', () => {
    expect(normalizeTrialEmailKey('wabil+1@outlook.com')).toBe('wabil@outlook.com');
    expect(normalizeTrialEmailKey('wabil+2@outlook.com')).toBe('wabil@outlook.com');
    expect(normalizeTrialEmailKey('wabil+anything.else@fastmail.com')).toBe('wabil@fastmail.com');
  });

  it('ignores Gmail dots and treats googlemail.com as gmail.com', () => {
    const key = 'wabil@gmail.com';
    expect(normalizeTrialEmailKey('w.abil@gmail.com')).toBe(key);
    expect(normalizeTrialEmailKey('w.a.b.i.l@gmail.com')).toBe(key);
    expect(normalizeTrialEmailKey('wabil+promo@gmail.com')).toBe(key);
    expect(normalizeTrialEmailKey('wa.bil+x@googlemail.com')).toBe(key);
    expect(normalizeTrialEmailKey('WABIL@GMAIL.COM')).toBe(key);
  });

  it('does NOT strip dots for non-Gmail providers (distinct inboxes stay distinct)', () => {
    // Outlook dots are significant — must not be merged.
    expect(normalizeTrialEmailKey('first.last@outlook.com')).toBe('first.last@outlook.com');
    expect(normalizeTrialEmailKey('a@corp.com')).not.toBe(normalizeTrialEmailKey('b@corp.com'));
  });

  it('trims + lowercases and tolerates a malformed address', () => {
    expect(normalizeTrialEmailKey('  Wabil@Corp.com ')).toBe('wabil@corp.com');
    expect(normalizeTrialEmailKey('not-an-email')).toBe('not-an-email');
  });

  it('all of one Gmail inbox\'s aliases collapse to ONE key (the anti-farming property)', () => {
    const variants = ['wabil@gmail.com', 'w.abil@gmail.com', 'wabil+1@gmail.com', 'wabil+2@gmail.com', 'WA.BIL@googlemail.com'];
    const keys = new Set(variants.map(normalizeTrialEmailKey));
    expect(keys.size).toBe(1);
  });
});
