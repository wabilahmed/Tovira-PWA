import { describe, it, expect } from 'vitest';
import { normaliseCounterpart, foldKey, sharesAWord } from './counterpart.js';
import { NARROW_SURFACE } from '../../eval/extraction-fingerprint.js';

// [P50-1 · owner] A person folds into the client ONLY on an exact full-name match (case, spaces and punctuation normalised)
// with the client's current name, a previous name or a learned alias. Never on a shared word: "never merge two people" is a
// zero rule, and a shared word ("Khalid", "Hills", "Rajesh") says nothing about whether two people are one. Phone numbers
// still match by number. The fold lives in its own file, on NARROW_SURFACE, so the gate's window sees any change to it.
const people = (...names: string[]) => names.map((name) => ({ name }));
const fold = (names: string[], client: string, aliases: string[] = [], previous: string[] = []) => {
  const ex = { people: people(...names), personal_facts: names.map((subject) => ({ subject })) };
  normaliseCounterpart(ex, client, aliases, previous);
  return { people: ex.people.map((p) => p.name), subjects: ex.personal_facts.map((f) => f.subject) };
};

describe('[P50-1] exact full-name folding only', () => {
  it('the client\'s exact name, a previous name or a learned alias folds into the client', () => {
    expect(fold(['Khalid Al Mansoori'], 'Khalid Al Mansoori').people).toEqual(['Khalid Al Mansoori']);
    expect(fold(['Khalid Dubai Marina'], 'Khalid Al Mansoori', [], ['Khalid Dubai Marina']).people).toEqual(['Khalid Al Mansoori']);
    expect(fold(['Bubu DXB', 'Sara'], 'Imtinan Qureshi', ['Bubu DXB'])).toEqual({ people: ['Imtinan Qureshi', 'Sara'], subjects: ['Imtinan Qureshi', 'Sara'] });
  });

  it('case, spacing and punctuation do not matter', () => {
    expect(fold(['  khalid   AL-mansoori. '], 'Khalid Al Mansoori').people).toEqual(['Khalid Al Mansoori']);
    expect(fold(['BUBU (DXB)'], 'Imtinan', ['Bubu DXB']).people).toEqual(['Imtinan']);
    expect(foldKey('Khalid  Al-Mansoori!')).toBe(foldKey('khalid al mansoori'));
  });

  it('NEGATIVE: a person who only shares a word with the client\'s name never folds', () => {
    expect(fold(['Khalid', 'Khalid Al Mansoori'], 'Khalid Al Mansoori').people).toEqual(['Khalid', 'Khalid Al Mansoori']);
    expect(fold(['Rajesh'], 'Rajesh Textiles').people).toEqual(['Rajesh']);
  });

  it('NEGATIVE: a person who only shares a word with an alias or a previous name never folds', () => {
    expect(fold(['Hills Properties'], 'Ahmed Al Falasi', ['Ahmed Dubai Hills']).people).toEqual(['Hills Properties']);
    expect(fold(['Marina'], 'Abdullah Al Mansoori', [], ['Khalid Dubai Marina']).subjects).toEqual(['Marina']);
  });

  it('a phone number still matches by number', () => {
    expect(fold(['+971 50 123 4567'], 'Khalid', [], ['00971501234567']).people).toEqual(['Khalid']);
    expect(fold(['050 999 0000'], 'Khalid', ['+971 50 123 4567']).people).toEqual(['050 999 0000']);
  });

  it('collapses the alias and the real name when both were emitted', () => {
    expect(fold(['Bubu DXB', 'Imtinan', 'Rashid'], 'Imtinan', ['Bubu DXB']).people).toEqual(['Imtinan', 'Rashid']);
  });

  it('sharesAWord finds the unfolded people worth asking about (for "Is X the same person as the client?")', () => {
    expect(sharesAWord('Khalid', 'Khalid Al Mansoori', [])).toBe(true);
    expect(sharesAWord('Hills Properties', 'Ahmed Al Falasi', ['Ahmed Dubai Hills'])).toBe(true);
    expect(sharesAWord('Sara', 'Khalid Al Mansoori', ['Ahmed Dubai Hills'])).toBe(false);
    expect(sharesAWord('Al', 'Khalid Al Mansoori', [])).toBe(false); // a short word ("Al", "bin") is not a name
  });

  it('NEGATIVE: the fold is on NARROW_SURFACE, so a change to it is caught by the gate\'s window', () => {
    expect(NARROW_SURFACE).toContain('services/extraction/counterpart.ts');
  });
});
