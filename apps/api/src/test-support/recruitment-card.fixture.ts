/**
 * [P69-14 · owner] The landing Recruitment card, as the real model extracted it in the P69 card check (5 runs,
 * 2026-11-12, shipped prompt v0.9.7). personal_facts are the model's exact output; each run's ask is the requirement
 * text that run stored. In every run the model filed the pregnancy as a "family" fact, so the category health
 * filter let it through. This is the fixture for the store-time pregnancy block: hybrid kept 5/5, pregnancy 0/5.
 */
export const RECRUITMENT_CLIENT = 'Sana Iqbal';
export const RECRUITMENT_CHAT =
  "[08/11/2026, 21:00] Sana Iqbal: Not looking to move right now\n[08/11/2026, 21:01] Sana Iqbal: after the baby I'd want hybrid\n[08/11/2026, 21:10] Me: Noted, I will keep you in mind";

const SPAN = "after the baby I'd want hybrid";
const fact = (text: string) => ({ subject: RECRUITMENT_CLIENT, fact: text, category: 'family', source_span: SPAN, source_message_at: '2026-11-08T21:01' });
const ask = (text: string) => ({ text, requirement_raw: SPAN, stated_on: '2026-11-08', confidence: 'low' });
const WORRY = 'Not looking to move right now';

export const RECRUITMENT_RUNS = [
  { personal_facts: [fact('Expecting a baby')], requirements: [ask('Hybrid work arrangement after the baby')], concerns: [WORRY] },
  { personal_facts: [fact('Expecting a baby')], requirements: [ask('Hybrid arrangement after the baby')], concerns: [WORRY] },
  { personal_facts: [fact('Expecting a baby')], requirements: [ask('Wants hybrid after the baby')], concerns: [] },
  { personal_facts: [fact('Expecting a baby')], requirements: [ask('Hybrid arrangement after having the baby')], concerns: [WORRY] },
  { personal_facts: [fact('Expecting a baby; will want hybrid option afterward')], requirements: [], concerns: [WORRY] },
].map((r) => ({ summary: 'Sana is not looking to move right now.', promises: [], people: [], key_dates: [], next_steps: [], meeting: null, ...r }));
