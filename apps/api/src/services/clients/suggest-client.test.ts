import { describe, it, expect } from 'vitest';
import { suggestClientFromTranscript } from './suggest-client.js';

// [P57-4 · owner] A voice "new client": before anything is created, the confirm step pre-fills who the rep met, from the
// transcript alone (no model call): the name after "met", "spoke to", "call with" and the like, the company after
// "from" or "at" when it follows the name, and a phone number said with its country code. A suggestion is only ever a
// pre-filled field the rep confirms or edits; when no name is heard the step asks "Who is this client?".
const s = suggestClientFromTranscript;

describe('[P57-4] suggesting the client from a transcript', () => {
  it('the owner\'s example: name and company', () => {
    expect(s("Just met Sara Khan from Emaar, she wants a 3-bed in Arabian Ranches, budget around 3 million, I said I'd send options by Thursday.")).toEqual({ name: 'Sara Khan', company: 'Emaar', phone: null });
  });
  it('other ways a rep says it', () => {
    expect(s('Met with Mr. Rahul Jain at Tata Motors today, wants 20 units.')).toMatchObject({ name: 'Rahul Jain', company: 'Tata Motors' });
    expect(s('Spoke to Omar, his number is +971 50 123 4567, call him Sunday.')).toEqual({ name: 'Omar', company: null, phone: '+971501234567' });
    expect(s('Had a call with Priya Nair of HDFC Life about her renewal.')).toMatchObject({ name: 'Priya Nair', company: 'HDFC Life' });
    expect(s('Coffee with Khalid Al Mansoori this morning.')).toMatchObject({ name: 'Khalid Al Mansoori' });
    expect(s('The client is Fatima Zahra, she runs procurement.')).toMatchObject({ name: 'Fatima Zahra' });
  });
  it('NEGATIVE: no name heard → no suggestion (the step asks "Who is this client?")', () => {
    for (const t of ['Quick note, they want a quote by Friday.', 'Met the team at the site, all good.', 'met yesterday about the renewal', 'Met Thursday to go over pricing.', '']) expect(s(t).name, t).toBeNull();
  });
  it('NEGATIVE: a company is only taken right after the name; a place on its own is not a company', () => {
    expect(s('Met Sara Khan today, she lives near Dubai Marina.').company).toBeNull();
  });
  it('NEGATIVE: a number without a country code is not suggested (it is never guessed)', () => {
    expect(s('Spoke to Omar, number 050 123 4567.').phone).toBeNull();
  });
});
