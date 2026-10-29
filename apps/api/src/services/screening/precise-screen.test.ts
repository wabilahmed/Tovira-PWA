import { describe, it, expect } from 'vitest';
import { screenPrecise } from './precise-screen.js';

// [P55-2 · owner] The precise list: what is withheld from the model automatically, with no human review. It names the
// sensitive thing itself (a diagnosis, a conviction, a personal statement of faith or observance, a vote or party, caste,
// orientation), never an ordinary business word that merely can mean one ("back", "party", "court", "charged",
// "operation", "church"). Holiday and festival names used as dates are not sensitive; only personal belief or observance is.
const hit = (t: string, category: string) => {
  const m = screenPrecise(t);
  expect(m.map((x) => x.category), t).toContain(category);
};
const clear = (t: string) => expect(screenPrecise(t), t).toEqual([]);

describe('[P55-2] hits', () => {
  it('health: a named condition, diagnosis or treatment', () => {
    for (const t of ['hepatitis B positive', 'she has diabetes', 'he is on dialysis', 'recovering from surgery', 'she is pregnant', 'diagnosed with depression', 'tested positive last week', 'has HIV', 'his cancer treatment', 'admitted to hospital on Monday', 'मुझे डायबिटीज है', 'वह गर्भवती है', 'عنده سرطان']) hit(t, 'health');
  });
  it('criminal: a conviction, arrest or record', () => {
    for (const t of ['I was convicted of theft in 2019', 'he has a criminal record', 'he was arrested last year', 'spent two years in prison', 'out on bail', 'charged with fraud', 'an FIR was filed against him', 'वह जेल गया था', 'كان في السجن']) hit(t, 'criminal');
  });
  it('religion: a personal statement of faith or observance', () => {
    for (const t of ['he is fasting for Ramadan', 'she is a devout Catholic', 'he is quite religious', 'he observes Ramadan', 'she celebrates Diwali with family', 'he prays five times a day', 'he goes to the mosque every Friday', 'she converted to Islam', 'मैं व्रत रख रहा हूँ', 'أنا صائم']) hit(t, 'religion');
  });
  it('political opinion: a vote, a party or campaigning for one', () => {
    for (const t of ['he votes for the National party', 'he campaigns for the Green Party', 'she is a BJP party worker', 'his political views are strong', 'he voted for Labour']) hit(t, 'political_opinion');
  });
  it('ethnicity and caste', () => {
    for (const t of ['his caste matters to the family', 'she is Dalit', 'from a Brahmin family', 'his ethnicity came up']) hit(t, 'ethnicity');
  });
  it('sexual orientation', () => {
    for (const t of ['he is gay', 'she is bisexual', 'his same-sex partner', 'she is transgender']) hit(t, 'sexual_life');
  });
});

describe('[P55-2] false hits: ordinary business words are never withheld', () => {
  it('NEGATIVE: the broad screen\'s over-flags', () => {
    for (const t of ["I'll call you back on Friday", "I'll get back to you Monday", "Let's catch up after the party on Saturday", 'The court date for the warehouse lease is Monday', 'They charged us AED 500 for the delivery', "The minister's office approved the permit", 'Meeting near the church on Al Wasl road', 'The operation team will deliver on Sunday', 'Treatment plant tender closes Thursday', 'No pain, he signed today', 'Send the case studies tomorrow', 'his Indian visa is ready', 'the Filipino agent called', 'the hospital project tender is out', 'fast delivery please', 'the campaign for the new launch starts Monday', 'the board votes on the budget Tuesday']) clear(t);
  });
  it('NEGATIVE: holiday and festival names used as dates are not sensitive', () => {
    for (const t of ['after Ramadan we sign', 'the Eid break is next week', 'post Diwali the prices go up', 'during Ramadan our office closes at 3', 'Ramadan timings start Monday', 'the Diwali sale ends Sunday', 'before Eid please', 'over the Christmas holidays', 'Happy Eid!', 'Eid Mubarak', 'after the fasting month', 'move it to after Friday prayers', 'Diwali के बाद मिलते हैं']) clear(t);
  });
});

describe('[P55-2] known misses (recorded, not hidden): vague or indirect mentions the list does not name', () => {
  it('these are NOT caught today', () => {
    for (const t of ['he has been unwell', 'she is not feeling great lately', 'some trouble with the police years ago', 'he has a stomach issue', 'he is feeling low', 'diabeties']) expect(screenPrecise(t), t).toEqual([]);
  });
});

describe('[P55-2] the P54 special-category items are all caught', () => {
  it('each sensitive sentence in the certification items is flagged', () => {
    hit('Sir medical report आ गई, hepatitis B positive आया है।', 'health');
    hit('Before the background check, I should tell you I was convicted of theft in 2019.', 'criminal');
    hit("Faisal asked to move Sunday's site visit to the evening because he is fasting for Ramadan.", 'religion');
    hit("Omar can't meet on Saturday because he campaigns for the Green Party at the weekend rally.", 'political_opinion');
    hit('He mentioned he is quite religious and votes for the National party.', 'religion');
  });
});

// [P55-2 · owner] More false hits closed: names, party names outside party context, account states, retail words.
describe('[P55-2] false hits from names and everyday words', () => {
  it('NEGATIVE: a religion word as a first name or surname is not a statement of faith', () => {
    clear('Rahul Jain sent the PO');
    clear('Christian confirmed Friday');
    clear('Mr. Jain will call tomorrow');
  });
  it('a religion word describing a person still counts', () => {
    for (const t of ['he is Jain', 'she is a practising Jain', 'he is a devout Christian', 'they are Sikh', 'she is a Hindu']) hit(t, 'religion');
  });
  it('NEGATIVE: party names without party context', () => {
    for (const t of ['his labour card expires in May', 'Ministry of Labour approved the quota', 'the labour visa is ready', 'a conservative estimate is AED 2M', 'we got the green light', 'shipping to the Democratic Republic of Congo', 'the national team won']) clear(t);
  });
  it('party names with party context still count', () => {
    for (const t of ['he voted for Labour', 'he is a Congress party member', 'she campaigns for the BJP', 'at the Labour rally on Sunday', 'he got a BJP ticket']) hit(t, 'political_opinion');
  });
  it('NEGATIVE: "disabled" about a thing is not a disability', () => {
    clear('the account is disabled');
    clear('notifications are disabled');
  });
  it('disability, and "disabled" describing a person, still count', () => {
    for (const t of ['he has a disability', 'her disabled son', 'a disabled employee']) hit(t, 'health');
  });
  it('NEGATIVE: "ethnic" as a product word is not ethnicity', () => {
    clear('the ethnic wear collection launches Friday');
  });
  it('"ethnicity" still counts', () => hit('his ethnicity came up', 'ethnicity'));
});
