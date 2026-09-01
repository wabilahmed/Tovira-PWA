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
  source: 'voice' | 'paste';
  note: string;
  expected: Extraction;
  /** Code-switched Arabic/Hindi/Urdu ↔ English — a locked P1-9 requirement. */
  multilingual?: boolean;
  /** Name pairs that MUST stay as two distinct people (never merged) — the
   *  hard "0 merged people" rule is scored against these. */
  mustNotMerge?: Array<[string, string]>;
  /** REDACT-5: values/fragments that must appear NOWHERE in the model output (leakage). */
  forbidden?: string[];
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
    note: "Please send payment to IBAN AE070331234567890123456. Separately — I'll deliver the final report on 4 September 2026.",
    expected: { ...empty, summary: 'Payment requested; rep will deliver the final report.', promises: [{ text: 'Deliver the final report', owner: 'rep', due_date: '2026-09-04', due_raw: '4 September 2026', confidence: 'high' }] },
    forbidden: ['AE0703', 'AE070331234567890123456'],
  },
  {
    id: 'redact-adjacency-inline', today: '2026-09-01', clientName: 'Orion Shipping', source: 'paste',
    note: "Once you've sent payment to IBAN AE070331234567890123456, I'll release the shipment on 8 September.",
    expected: { ...empty, summary: 'Rep will release the shipment once payment is received.', promises: [{ text: 'Release the shipment', owner: 'rep', due_date: null, due_raw: '8 September', confidence: 'high' }] },
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
];
