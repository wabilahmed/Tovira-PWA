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
      people: [{ name: 'Ahmed', role: null, reports_to: null, decision_role: 'unknown', notes: 'Gulf Real Estate' }],
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
];
