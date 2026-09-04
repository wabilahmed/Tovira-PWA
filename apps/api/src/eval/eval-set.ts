import type { Extraction } from '../services/extraction/types.js';

/**
 * The extraction quality gate's eval set (P1-9): real-shaped, messy notes with a
 * known-correct extraction. Precision/recall on promises, dates and people is
 * measured against this; the gate blocks Phase 2 if the model fabricates a
 * promise or guesses a date. Grow this with real anonymised notes over time.
 */
export interface EvalNote {
  id: string;
  today: string;
  clientName: string;
  source: 'voice' | 'paste' | 'whatsapp_export';
  note: string;
  expected: Extraction;
  /** Code-switched Arabic/Hindi/Urdu ↔ English — a locked P1-9 requirement. */
  multilingual?: boolean;
  /** Name pairs that MUST stay as two distinct people (never merged) — the
   *  hard "0 merged people" rule is scored against these. */
  mustNotMerge?: Array<[string, string]>;
  /** REDACT-5: values/fragments that must appear NOWHERE in the model output (leakage). */
  forbidden?: string[];
  /** REQ-CERT (JC1): for an imported chat, the in-transcript date on which the requirement
   *  was stated — distinct from `today` (the import/reference date). The expected requirements'
   *  stated_on must equal this and differ from today; that is what proves stated_on tracks the
   *  note's reference date, not the clock (the DATE-REF regression class). Asserted in the test. */
  importMessageDate?: string;
}

const empty = {
  promises: [] as Extraction['promises'],
  people: [] as Extraction['people'],
  personal_facts: [],
  key_dates: [] as Extraction['key_dates'],
  concerns: [],
  next_steps: [],
  meeting: null as Extraction['meeting'],
};

export const EVAL_NOTES: EvalNote[] = [
  {
    id: 'firm-promise-resolvable-date',
    today: '2026-07-09',
    clientName: 'Northwind',
    source: 'voice',
    note: "Spoke to the buyer at Northwind. I committed to sending the signed MSA by this Friday. They confirmed budget is approved for Q3.",
    expected: {
      ...empty,
      summary: 'Committed to sending the signed MSA to Northwind; budget approved for Q3.',
      promises: [{ text: 'Send the signed MSA', owner: 'rep', due_date: '2026-07-10', due_raw: 'this Friday', confidence: 'high' }],
    },
  },
  {
    id: 'no-commitment-catchup',
    today: '2026-07-09',
    clientName: 'Acme',
    source: 'voice',
    note: "Quick coffee with Tom at Acme. Nothing new on the deal, just keeping warm. He's heading to Portugal for a golf trip next month. Good mood, that's it.",
    expected: {
      ...empty,
      summary: 'Relationship catch-up with Tom at Acme; no business movement.',
      promises: [], // a fabricated promise here must fail the gate
      people: [{ name: 'Tom', role: null, reports_to: null, decision_role: 'unknown', notes: 'Contact at Acme' }],
      personal_facts: [{ subject: 'Tom', fact: 'Golf trip to Portugal next month', category: 'hobby' }],
    },
  },
  {
    id: 'unresolved-vague-date',
    today: '2026-07-09',
    clientName: 'Halcyon',
    source: 'paste',
    note: "Client says they'll circle back on the contract sometime after the holidays. No firm date.",
    expected: {
      ...empty,
      summary: 'Client will revisit the contract after the holidays; no firm date.',
      // due_date MUST be null — guessing a specific date must fail the gate.
      promises: [{ text: 'Circle back on the contract', owner: 'client', due_date: null, due_raw: 'sometime after the holidays', confidence: 'low' }],
    },
  },
  {
    id: 'decision-maker-person',
    today: '2026-07-09',
    clientName: 'Meridian',
    source: 'voice',
    note: "Jordan at Meridian is the VP of ops and the one who signs off on this. Sarah just influences.",
    expected: {
      ...empty,
      summary: 'Jordan (VP Ops) is the decision-maker at Meridian; Sarah is an influencer.',
      people: [
        { name: 'Jordan', role: 'VP of Operations', reports_to: null, decision_role: 'decision_maker', notes: 'Signs off' },
        { name: 'Sarah', role: null, reports_to: null, decision_role: 'influencer', notes: 'Influences' },
      ],
    },
  },
  {
    id: 'two-similar-names',
    today: '2026-07-09',
    clientName: 'Halcyon',
    source: 'voice',
    mustNotMerge: [['Sarah', 'Sara']],
    note: "Met the team at Halcyon. Sarah walked us through requirements. Later a Sara from finance joined - not sure it's the same person.",
    expected: {
      ...empty,
      summary: 'Requirements meeting at Halcyon with Sarah; a Sara from finance also joined.',
      people: [
        { name: 'Sarah', role: null, reports_to: null, decision_role: 'unknown', notes: 'Walked through requirements' },
        { name: 'Sara', role: 'finance', reports_to: null, decision_role: 'unknown', notes: 'From finance' },
      ],
    },
  },
  {
    id: 'meeting-and-launch-date',
    today: '2026-07-09',
    clientName: 'Vertex',
    source: 'paste',
    note: "can we do a call thursday 3pm? also their product launches march 3rd and they want us live before then",
    expected: {
      ...empty,
      summary: 'Vertex proposed a call and is launching a product on March 3rd.',
      key_dates: [{ description: 'Vertex product launch', date: null, date_raw: 'march 3rd', type: 'launch' }],
      meeting: { datetime: null, datetime_raw: 'thursday 3pm', confirmed: false },
    },
  },

  // ---- Code-switched multilingual notes (P1-9, locked requirement) ----
  // Gulf sales conversations mix Arabic/Hindi/Urdu with English mid-sentence.
  // Facts must be extracted regardless of the language mix; dates still resolve,
  // and an unresolvable date still stays null (no guessing across languages).
  {
    id: 'arabic-english-resolvable',
    today: '2026-08-01',
    clientName: 'Gulf Real Estate',
    source: 'voice',
    multilingual: true,
    note: 'اجتمعت مع Ahmed من Gulf Real Estate اليوم. He said الميزانية approved for the villas project, wa promised him I will arsel the revised quote bukra.',
    expected: {
      ...empty,
      summary: 'Met Ahmed at Gulf Real Estate; budget approved for the villas project; promised the revised quote tomorrow.',
      promises: [{ text: 'Send the revised quote', owner: 'rep', due_date: '2026-08-02', due_raw: 'bukra', confidence: 'high' }],
      people: [{ name: 'Ahmed', role: null, reports_to: null, decision_role: 'unknown', notes: null }],
    },
  },
  {
    id: 'hindi-english-resolvable',
    today: '2026-08-01',
    clientName: 'Rajesh Textiles',
    source: 'paste',
    multilingual: true,
    note: 'Rajesh ne message kiya — unhe pricing thoda zyada lag raha hai लेकिन he is still interested. Maine kaha main revised proposal bhej dunga day after tomorrow.',
    expected: {
      ...empty,
      summary: 'Rajesh finds the pricing a bit high but is still interested; promised a revised proposal.',
      promises: [{ text: 'Send the revised proposal', owner: 'rep', due_date: '2026-08-03', due_raw: 'day after tomorrow', confidence: 'high' }],
      people: [{ name: 'Rajesh', role: null, reports_to: null, decision_role: 'unknown', notes: null }],
      concerns: ['pricing seems a bit high'],
    },
  },
  {
    id: 'urdu-english-unresolvable-date',
    today: '2026-08-01',
    clientName: 'Al Habib Group',
    source: 'voice',
    multilingual: true,
    note: 'کلائنٹ نے کہا budget abhi confirm nahi hua hai. I promised to send the brochure لیکن koi fixed date nahi — jab budget confirm ho jaye tab.',
    expected: {
      ...empty,
      summary: 'Budget not yet confirmed; promised to send the brochure once the budget is confirmed, no fixed date.',
      promises: [{ text: 'Send the brochure', owner: 'rep', due_date: null, due_raw: 'when budget is confirmed', confidence: 'low' }],
      concerns: ['budget not yet confirmed'],
    },
  },

  // ==== v0.5 EVAL EXPANSION — DRAFT v2, awaiting Wabil's certification ====
  // today is PINNED per note (runner injects note.today; never the real clock).
  // Every expected field traces to explicit note text — see the certification
  // annotations in the report. Named-people count varies (1 / 2 / 3) on purpose.
  //
  // (a) multilingual, single person + an UNRESOLVABLE (year-less) date.
  {
    id: 'ml-arabic-one-person-unresolvable',
    today: '2026-08-01',
    clientName: 'Aldar',
    source: 'voice',
    multilingual: true,
    note: 'كلمت Yusuf من Aldar اليوم. قال المعرض بتاعهم في مارس, و يبون العرض جاهز قبله.',
    expected: {
      ...empty,
      summary: 'Spoke with Yusuf at Aldar; their exhibition is in March and they want the proposal ready before it.',
      people: [{ name: 'Yusuf', role: null, reports_to: null, decision_role: 'unknown', notes: null }],
      key_dates: [{ description: 'Their exhibition', date: null, date_raw: 'مارس', type: 'other' }],
      next_steps: ['Have the proposal ready before their exhibition'],
    },
  },
  // (b) multilingual, THREE people (one decision-maker stated, two unknown).
  {
    id: 'ml-hindi-three-people',
    today: '2026-08-01',
    clientName: 'Wipro',
    source: 'paste',
    multilingual: true,
    note: 'Aditya, Meena aur Sanjay ke saath call hui Wipro mein. Aditya project lead hain, Meena finance dekhti hain, Sanjay technical side. फैसला Aditya करेंगे.',
    expected: {
      ...empty,
      summary: 'Call with Aditya (project lead), Meena (finance) and Sanjay (technical) at Wipro; Aditya will decide.',
      people: [
        { name: 'Aditya', role: 'project lead', reports_to: null, decision_role: 'decision_maker', notes: 'Will decide' },
        { name: 'Meena', role: 'finance', reports_to: null, decision_role: 'unknown', notes: null },
        { name: 'Sanjay', role: 'technical', reports_to: null, decision_role: 'unknown', notes: null },
      ],
    },
  },
  // (c) multilingual, two people — no inferred reports_to, no inferred influence.
  {
    id: 'ml-urdu-two-people',
    today: '2026-08-01',
    clientName: 'Habib Bank',
    source: 'voice',
    multilingual: true,
    note: 'Bilal sahib se baat hui Habib Bank mein. Woh procurement dekhte hain. Unhone kaha ke unki manager Fatima final approval دیں گی. بجٹ کنفرم ہے.',
    expected: {
      ...empty,
      summary: 'Spoke with Bilal (procurement) at Habib Bank; a manager, Fatima, gives final approval; budget confirmed.',
      people: [
        { name: 'Bilal', role: 'procurement', reports_to: null, decision_role: 'unknown', notes: 'Handles procurement' },
        { name: 'Fatima', role: 'manager', reports_to: null, decision_role: 'decision_maker', notes: 'Gives final approval' },
      ],
    },
  },
  // (d) multilingual, two people — role stated, decision authority NOT stated.
  {
    id: 'ml-arabic-two-people-visit',
    today: '2026-08-01',
    clientName: 'Dubai Hills',
    source: 'voice',
    multilingual: true,
    note: 'Site visit مع Omar و Huda اليوم في Dubai Hills. Omar هو المالك و Huda مهندسة. اتفقنا نكمل بعدين.',
    expected: {
      ...empty,
      summary: 'Site visit with Omar (owner) and Huda (engineer) at Dubai Hills; agreed to continue later.',
      people: [
        { name: 'Omar', role: 'owner', reports_to: null, decision_role: 'unknown', notes: null },
        { name: 'Huda', role: 'engineer', reports_to: null, decision_role: 'unknown', notes: null },
      ],
      next_steps: ['Continue the discussion later'],
    },
  },
  // (e) Role-only references (unnamed, INCIDENTAL — no "no names" tell). v0.5
  //     regression: a role is not a person; never a null-named person.
  {
    id: 'role-only-buyer-cfo',
    today: '2026-08-01',
    clientName: 'Northwind',
    source: 'paste',
    note: 'Call with the buyer at Northwind. He wants the pricing in writing before their CFO signs off.',
    expected: {
      ...empty,
      summary: 'The buyer at Northwind wants pricing in writing before their CFO signs off.',
      next_steps: ['Provide the pricing in writing before their CFO signs off'],
    },
  },
  {
    id: 'role-only-procurement',
    today: '2026-08-01',
    clientName: 'Meridian',
    source: 'voice',
    note: 'Their procurement lead is holding things up — the CFO still has not approved the budget.',
    expected: {
      ...empty,
      summary: 'Their procurement lead is holding things up; the CFO has not approved the budget.',
      concerns: ['Their procurement lead is holding things up', 'Budget not yet approved by their CFO'],
    },
  },
  {
    id: 'role-only-finance-manager',
    today: '2026-08-01',
    clientName: 'Vertex',
    source: 'paste',
    note: 'Both the buyer and their finance manager need to sign before this moves.',
    expected: {
      ...empty,
      summary: 'The buyer and their finance manager both need to sign before this moves forward.',
      next_steps: ['Get the buyer and their finance manager to sign'],
    },
  },
  // v0.6 (certified 2026-09-01): an AMBIGUOUS numeric date — both components ≤ 12, so
  // DD/MM and MM/DD are both valid (05/06/2026 is 5 June OR 6 May) — must stay null with
  // the raw string kept; the note's locale is unknowable (WhatsApp exports carry the
  // producing phone's locale). Resolving it to any date is a guessed date and fails the
  // gate. The promise itself is firm, so its confidence is high — this tests the DATE.
  {
    id: 'ambiguous-numeric-date',
    today: '2026-07-09',
    clientName: 'Delta Freight',
    source: 'paste',
    note: 'I promised to send them the signed contract by 05/06/2026.',
    expected: {
      ...empty,
      summary: 'Rep committed to sending Delta Freight the signed contract by a date given in ambiguous numeric form.',
      promises: [{ text: 'Send the signed contract', owner: 'rep', due_date: null, due_raw: '05/06/2026', confidence: 'high' }],
    },
  },
  // v0.6 (certified 2026-09-01): a CONDITIONAL promise — contingent on an event that has
  // not happened ("once the MSA is signed") — IS a real commitment and must be logged,
  // but with confidence LOW so it routes to confirmation rather than the open list.
  {
    id: 'conditional-promise',
    today: '2026-07-09',
    clientName: 'Orion Systems',
    source: 'voice',
    note: "Told them once the MSA is signed, I'll introduce them to our onboarding team.",
    expected: {
      ...empty,
      summary: "Rep will introduce the onboarding team once Orion's MSA is signed.",
      promises: [{ text: 'Introduce the onboarding team', owner: 'rep', due_date: null, due_raw: 'once the MSA is signed', confidence: 'low' }],
    },
  },
  // REDACT-5 (v0.7, certified 2026-09-02): sensitive data must never reach any output
  // field. `forbidden` lists values + identifying fragments that must appear NOWHERE in
  // the model's output (the leakage check catches partial masks like 784-1990 too).
  {
    id: 'redact-iban-card', today: '2026-09-01', clientName: 'Delta Trading', source: 'paste',
    note: "Client sent card 4539 1488 0343 6467 and IBAN AE070331234567890123456 for the deposit. I'll send the signed invoice this Friday.",
    expected: { ...empty, summary: 'Client shared payment details for the deposit; rep will send the signed invoice.', promises: [{ text: 'Send the signed invoice', owner: 'rep', due_date: '2026-09-04', due_raw: 'this Friday', confidence: 'high' }] },
    forbidden: ['4539', '1488', '0343', '6467', 'AE0703', 'AE070331234567890123456'],
  },
  {
    id: 'redact-emirates-id', today: '2026-09-01', clientName: 'Nimbus FZE', source: 'paste',
    note: 'Omar shared his Emirates ID 784-1990-1234567-1 to verify. I will add him to the account.',
    expected: { ...empty, summary: 'Omar verified his identity; rep will add him to the account.', promises: [{ text: 'Add Omar to the account', owner: 'rep', due_date: null, due_raw: null, confidence: 'high' }], people: [{ name: 'Omar', role: null, reports_to: null, decision_role: 'unknown', notes: 'Contact at Nimbus FZE' }] },
    forbidden: ['784-1990', '1234567', '784-1990-1234567', '7841990'],
  },
  {
    id: 'special-category-not-a-fact', today: '2026-09-01', clientName: 'Cobalt Retail', source: 'paste',
    note: "He mentioned he is quite religious and votes for the National party. Good rapport overall. I'll send the brochure tomorrow.",
    expected: { ...empty, summary: 'Good rapport with the client; rep will send the brochure.', promises: [{ text: 'Send the brochure', owner: 'rep', due_date: '2026-09-02', due_raw: 'tomorrow', confidence: 'high' }] },
    forbidden: ['religious', 'National party', 'votes'],
  },
  {
    id: 'redact-fp-guard', today: '2026-09-01', clientName: 'Vertex Logistics', source: 'paste',
    note: "Ordered 100000 units at AED 45000, ref ORD-20260901-0042, call me on +971 50 123 4567. I'll confirm the PO Friday.",
    expected: { ...empty, summary: 'Order placed (100000 units, AED 45000); rep will confirm the PO.', promises: [{ text: 'Confirm the PO', owner: 'rep', due_date: '2026-09-04', due_raw: 'Friday', confidence: 'high' }] },
    forbidden: [],
  },
  {
    id: 'redact-adjacency', today: '2026-09-01', clientName: 'Halcyon Group', source: 'paste',
    note: "The deposit landed in IBAN AE070331234567890123456 yesterday. Separately — I'll deliver the final report on 4 September 2026.",
    expected: { ...empty, summary: 'Payment requested; rep will deliver the final report.', promises: [{ text: 'Deliver the final report', owner: 'rep', due_date: '2026-09-04', due_raw: '4 September 2026', confidence: 'high' }] },
    forbidden: ['AE0703', 'AE070331234567890123456'],
  },
  {
    id: 'redact-adjacency-inline', today: '2026-09-01', clientName: 'Orion Shipping', source: 'paste',
    note: "Once the payment to IBAN AE070331234567890123456 clears, I'll release the shipment on 8 September 2026.",
    expected: { ...empty, summary: 'Rep will release the shipment once payment clears.', promises: [{ text: 'Release the shipment once payment clears', owner: 'rep', due_date: '2026-09-08', due_raw: '8 September 2026', confidence: 'low' }] },
    forbidden: ['AE0703', 'AE070331234567890123456'],
  },
  {
    id: 'redact-collision', today: '2026-09-01', clientName: 'Solstice Co', source: 'paste',
    note: 'Can you send the payment to IBAN AE070331234567890123456 today?',
    expected: { ...empty, summary: "Client asked the rep to make a payment to their bank account today.", promises: [{ text: "Make the payment to the client's bank account", owner: 'rep', due_date: '2026-09-01', due_raw: 'today', confidence: 'low' }] },
    forbidden: ['AE0703', 'AE070331234567890123456'],
  },
  {
    id: 'health-exclusion', today: '2026-09-01', clientName: 'Meridian Corp', source: 'paste',
    note: "Client had knee surgery last week, back at work next month. I'll send the renewal quote this Friday.",
    expected: { ...empty, summary: 'Rep will send the renewal quote.', promises: [{ text: 'Send the renewal quote', owner: 'rep', due_date: '2026-09-04', due_raw: 'this Friday', confidence: 'high' }] },
    forbidden: ['surgery', 'knee'],
  },
  // DATE-FIXTURES (v0.7, certified 2026-09-02): reference date + no-past-due. Imported
  // cases set `today` to the MESSAGE date (the eval feeds today directly), mirroring the
  // referenceDateFor(note) fix. No new inference (Rule 2 holds), no new restriction.
  { id: 'date-fresh-friday', today: '2026-09-01', clientName: 'Acme', source: 'paste',
    note: "I'll send the deck this Friday.",
    expected: { ...empty, summary: 'Rep will send the deck this Friday.', promises: [{ text: 'Send the deck', owner: 'rep', due_date: '2026-09-04', due_raw: 'this Friday', confidence: 'high' }] } },
  { id: 'date-fresh-by-monday', today: '2026-09-02', clientName: 'Beacon', source: 'paste',
    note: "I'll get the revised terms to you by Monday.",
    expected: { ...empty, summary: 'Rep will send the revised terms by Monday.', promises: [{ text: 'Send the revised terms', owner: 'rep', due_date: '2026-09-07', due_raw: 'by Monday', confidence: 'high' }] } },
  { id: 'date-fresh-backwards', today: '2026-09-02', clientName: 'Cirrus', source: 'paste',
    note: 'I was supposed to send the contract last Friday.',
    expected: { ...empty, summary: 'Rep notes the contract was due last Friday and not sent.', promises: [{ text: 'Send the contract', owner: 'rep', due_date: null, due_raw: 'last Friday', confidence: 'high' }] } },
  { id: 'date-import-day-only', today: '2026-03-10', clientName: 'Delta', source: 'paste',
    note: "I'll get you the report by the 20th.",
    expected: { ...empty, summary: 'Rep committed to sending the report by the 20th.', promises: [{ text: 'Send the report', owner: 'rep', due_date: null, due_raw: 'the 20th', confidence: 'high' }] } },
  { id: 'date-import-absolute', today: '2026-03-10', clientName: 'Delta', source: 'paste',
    note: "I'll get you the report by 20 March 2026.",
    expected: { ...empty, summary: 'Rep committed to sending the report by 20 March 2026.', promises: [{ text: 'Send the report', owner: 'rep', due_date: '2026-03-20', due_raw: '20 March 2026', confidence: 'high' }] } },
  { id: 'date-import-relative', today: '2026-03-10', clientName: 'Delta', source: 'paste',
    note: "I'll send the samples this Friday.",
    expected: { ...empty, summary: 'Rep will send the samples this Friday.', promises: [{ text: 'Send the samples', owner: 'rep', due_date: '2026-03-13', due_raw: 'this Friday', confidence: 'high' }] } },
  // ==== REQ-CERT — the requirements field (v0.9.1), CERTIFIED by the owner 2026-09-04. ====
  // Corrections applied: (A) fixture req-clear keeps "budget around 4 million" — adding a
  // currency ("AED") is an inference the note does not state. (B) fixture req-beside-tier1
  // emits the "has a son" personal fact AND keeps "for his son" in the requirement text — a
  // second over-suppression guard next to a redacted Emirates ID. Rulings: a client question
  // is NOT a requirement; a concern/complaint/speculation is NOT a requirement; stated_on = the
  // note's reference date (= today for a fresh note). Every expected value traces to explicit text.
  {
    id: 'req-clear', today: '2026-07-09', clientName: 'Palm Realty', source: 'paste',
    note: 'Omar at Palm Realty is looking for a 3-bed villa in Arabian Ranches, budget around 4 million.',
    expected: { ...empty,
      summary: 'Omar at Palm Realty is looking for a 3-bed villa in Arabian Ranches, budget around 4 million.',
      people: [{ name: 'Omar', role: null, reports_to: null, decision_role: 'unknown', notes: null }],
      requirements: [{ text: 'A 3-bed villa in Arabian Ranches (budget around 4 million)', requirement_raw: 'looking for a 3-bed villa in Arabian Ranches, budget around 4 million', stated_on: '2026-07-09', confidence: 'high' }],
    },
  },
  {
    id: 'req-concern-boundary', today: '2026-07-09', clientName: 'Marina Estates', source: 'voice',
    note: 'Spoke to Layla at Marina Estates. She said the pricing on the units we showed is above her budget.',
    expected: { ...empty,
      summary: 'Layla at Marina Estates said the pricing on the units shown is above her budget.',
      people: [{ name: 'Layla', role: null, reports_to: null, decision_role: 'unknown', notes: null }],
      concerns: ['Pricing on the units shown is above her budget'],
      requirements: [],
    },
  },
  {
    id: 'req-rep-speculation', today: '2026-07-09', clientName: 'Nassar Family', source: 'voice',
    note: "Met the Nassar family. I think they'd probably want the corner unit, but they didn't actually say.",
    expected: { ...empty,
      summary: 'Met the Nassar family; the rep suspects they would want the corner unit, but they did not say so.',
      requirements: [],
    },
  },
  {
    id: 'req-client-question', today: '2026-07-09', clientName: 'Ahmed', source: 'paste',
    note: 'Ahmed messaged asking: do you have anything with parking?',
    expected: { ...empty,
      summary: 'Ahmed asked whether there is anything available with parking.',
      requirements: [],
    },
  },
  {
    id: 'req-conditional', today: '2026-07-09', clientName: 'Fatima', source: 'voice',
    note: "Fatima said if the mortgage clears, they'd want two units side by side in the same tower.",
    expected: { ...empty,
      summary: 'Fatima said that, if the mortgage clears, they would want two units side by side in the same tower.',
      requirements: [{ text: 'Two units side by side in the same tower', requirement_raw: "if the mortgage clears, they'd want two units side by side in the same tower", stated_on: '2026-07-09', confidence: 'low' }],
    },
  },
  {
    id: 'req-code-switched', today: '2026-07-09', clientName: 'Downtown Living', source: 'paste', multilingual: true,
    note: 'يدور على شقة قريبة من المترو، two bedrooms.',
    expected: { ...empty,
      summary: 'Client is looking for a two-bedroom apartment near the metro.',
      requirements: [{ text: 'A two-bedroom apartment near the metro', requirement_raw: 'يدور على شقة قريبة من المترو، two bedrooms', stated_on: '2026-07-09', confidence: 'high' }],
    },
  },
  {
    id: 'req-beside-tier1', today: '2026-07-09', clientName: 'Ravi', source: 'paste',
    note: 'Ravi is looking for a 1-bed in JLT for his son. He shared his Emirates ID 784-1990-1234567-1 for the paperwork.',
    expected: { ...empty,
      summary: 'Ravi is looking for a 1-bed in JLT for his son; he shared his Emirates ID for the paperwork.',
      personal_facts: [{ subject: 'Ravi', fact: 'Has a son', category: 'family' }],
      requirements: [{ text: 'A 1-bed in JLT (for his son)', requirement_raw: 'looking for a 1-bed in JLT for his son', stated_on: '2026-07-09', confidence: 'high' }],
    },
    forbidden: ['784-1990-1234567-1', '784-1990', '1234567', '784 1990 1234567 1', '7841990'],
  },
  // JC1 — the 8th, import-dated fixture. The transcript spans March→July; TODAY'S DATE (the
  // import/reference date) is 2026-07-09, but the need was stated on the 15/03/2026 line, so
  // stated_on = 2026-03-15 (≠ today). 15 > 12 forces DD/MM, so the date is unambiguous. If the
  // model sets stated_on to today's injected date instead of the message's own date, this fails
  // — the only fixture that can catch stated_on regressing to the reference clock (Rule 8).
  {
    id: 'req-import-dated', today: '2026-07-09', clientName: 'Mirdif Holdings', source: 'whatsapp_export',
    importMessageDate: '2026-03-15',
    note: '[15/03/2026, 14:22] Client: We are looking for a 3-bed with a maids room in Mirdif\n[09/07/2026, 10:05] Client: Any update on that?',
    expected: { ...empty,
      summary: "Client is looking for a 3-bed with a maid's room in Mirdif; later followed up asking for an update.",
      requirements: [{ text: "A 3-bed with a maid's room in Mirdif", requirement_raw: 'We are looking for a 3-bed with a maids room in Mirdif', stated_on: '2026-03-15', confidence: 'high' }],
    },
  },
  // ==== REQ-PRECISION — the v0.9.2 do-vs-find fixtures, CERTIFIED by the owner 2026-09-04. ====
  // From the A1 diagnosis: 98% of requirement FPs were next-step→requirement, 2% past-purchase, and
  // 0 concern/question/speculation (those boundaries already held). One fixture per class found,
  // plus a recall guard. Every expected value traces to explicit text.
  {
    id: 'req-next-step-not-requirement', today: '2026-07-09', clientName: 'Palm Realty', source: 'voice',
    note: 'Faisal wants the floor plans and the service-charge breakdown sent over before he decides.',
    expected: { ...empty,
      summary: 'Faisal wants the floor plans and the service-charge breakdown sent over before he decides.',
      people: [{ name: 'Faisal', role: null, reports_to: null, decision_role: 'unknown', notes: null }],
      next_steps: ['Send the floor plans and the service-charge breakdown'],
      requirements: [], // he asked us to DO something (send), not to FIND a property — a next step
    },
  },
  {
    id: 'req-past-purchase-not-requirement', today: '2026-07-09', clientName: 'Rashid', source: 'paste',
    note: 'Rashid bought the JLT 1-bed we showed him last month. He mentioned his brother is looking for something similar in the same building.',
    expected: { ...empty,
      summary: 'Rashid bought the JLT 1-bed shown last month and mentioned his brother is looking for something similar in the same building.',
      requirements: [], // a past purchase is not a forward need; the brother's need is a THIRD PARTY's, reported by the client — not the client's own stated requirement
    },
  },
  {
    id: 'req-recall-guard', today: '2026-07-09', clientName: 'Arabian Ranches Homes', source: 'voice',
    note: 'Mariam is looking for a 3-bed in Arabian Ranches with a garden. She also wants the brochure emailed over today.',
    expected: { ...empty,
      summary: 'Mariam is looking for a 3-bed in Arabian Ranches with a garden; she also wants the brochure emailed over today.',
      people: [{ name: 'Mariam', role: null, reports_to: null, decision_role: 'unknown', notes: null }],
      next_steps: ['Email the brochure over today'],
      requirements: [{ text: 'A 3-bed in Arabian Ranches with a garden', requirement_raw: 'looking for a 3-bed in Arabian Ranches with a garden', stated_on: '2026-07-09', confidence: 'high' }],
    },
  },
  // ==== REQ-3P — the v0.9.3 actor-distinction fixtures, CERTIFIED by the owner 2026-09-05. ====
  // The v0.9.2 residual (30/30 FPs) was one class: a need the client REPORTS for a third party.
  // The test is who is doing the LOOKING, not who benefits. Every expected value traces to text.
  {
    id: 'req-third-party-referral', today: '2026-07-09', clientName: 'Omar', source: 'voice',
    note: 'Quick call with Omar. He mentioned his colleague is looking for a 2-bed in the Marina, budget around 3 million.',
    expected: { ...empty,
      summary: 'Quick call with Omar; he mentioned his colleague is looking for a 2-bed in the Marina, budget around 3 million.',
      next_steps: ["Follow up on the colleague's interest in a 2-bed in the Marina, budget around 3 million"],
      requirements: [], // the COLLEAGUE is looking; Omar is reporting → a referral, recorded faithfully (budget kept) in next_steps, not a requirement
    },
  },
  {
    id: 'req-on-behalf-of', today: '2026-07-09', clientName: 'Layla', source: 'voice',
    note: 'Layla is looking for a 3-bed in Mirdif for her elderly parents, ground floor.',
    expected: { ...empty,
      summary: 'Layla is looking for a 3-bed in Mirdif for her elderly parents, ground floor.',
      requirements: [{ text: 'A 3-bed in Mirdif for her elderly parents (ground floor)', requirement_raw: 'looking for a 3-bed in Mirdif for her elderly parents, ground floor', stated_on: '2026-07-09', confidence: 'high' }],
      // LAYLA is the one looking, on her parents' behalf → her requirement, high (who is looking, not who benefits) — the on-behalf-of recall guard.
    },
  },
  {
    id: 'req-actor-split', today: '2026-07-09', clientName: 'Faisal', source: 'voice',
    note: 'Faisal is looking for a 2-bed in Downtown for himself. He also said his brother is after a villa in the Springs.',
    expected: { ...empty,
      summary: 'Faisal is looking for a 2-bed in Downtown for himself; he said his brother is after a villa in the Springs.',
      next_steps: ["Follow up on the brother's interest in a villa in the Springs"],
      requirements: [{ text: 'A 2-bed in Downtown', requirement_raw: 'looking for a 2-bed in Downtown for himself', stated_on: '2026-07-09', confidence: 'high' }],
      // Faisal looking (own → requirement) vs brother looking (reported → next step) in ONE note — the discrimination test.
    },
  },
];
