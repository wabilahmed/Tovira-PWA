import type { Extraction } from '../services/extraction/types.js';
import type { InvariantContract } from './score-invariants.js';

/**
 * [GATE-IMPORT-SIZE] Import-sized gate fixtures — the regime the single-note eval set never covered
 * (the blind spot that let the max_tokens starvation and the 30s timeout ship). All SYNTHETIC (no real
 * customer content, per Wabil's ruling), built from the certified B1 contracts.
 *
 *  - The small fixture (Omar) is scored FULL-OUTPUT: its transcript and `expected` must agree, so the
 *    ONLY rep commitments in the transcript are the three planted promises (incidental soft phrases
 *    were rewritten to non-commitments, or a correct model would extract them and score as fabricated).
 *  - Medium (Farah) and hard (Imtinan, 2019→2024) are scored by INVARIANT CONTRACT (scoreInvariants):
 *    planted anchors found, trust rules hold, nothing fabricated — because full-output ground truth is
 *    not honestly achievable at those sizes.
 *
 * import-fixtures.test.ts runs a CONSISTENCY pass: every anchor a fixture asserts must actually appear
 * (verbatim/close) in that fixture's transcript — so nothing fails the certification "for the wrong
 * reason" (an anchor reworded during synthesis).
 */

export interface FullOutputFixture {
  id: string;
  mode: 'full';
  clientName: string;
  today: string;
  transcript: string;
  expected: Extraction;
  /** Values that must appear NOWHERE in the output (leak check). */
  forbidden?: string[];
  tier: 'ci-subset' | 'cert-only';
}

export interface InvariantFixture {
  id: string;
  mode: 'invariant';
  clientName: string;
  today: string;
  transcript: string;
  contract: InvariantContract;
  tier: 'ci-subset' | 'cert-only';
}

export type ImportFixture = FullOutputFixture | InvariantFixture;

// ─────────────────────────────────────────────────────────────────────────────
// Small — Omar Al Mansouri (~30 msgs, June 2024). FULL-OUTPUT. import ref 2026-09-08.
// ─────────────────────────────────────────────────────────────────────────────
const OMAR_TRANSCRIPT = [
  '03/06/2024, 09:14 - Messages and calls are end-to-end encrypted.',
  '03/06/2024, 09:14 - Me: Morning Omar, good to meet you Sunday. تمام, looking forward to it.',
  '03/06/2024, 09:31 - Omar Al Mansouri: Morning! Yes was a good session. Send me the revised quote when you can',
  '03/06/2024, 09:33 - Me: Will do — I\'ll get the revised quote over to you by Thursday.',
  '03/06/2024, 09:34 - Omar Al Mansouri: Perfect إن شاء الله',
  '03/06/2024, 09:40 - Omar Al Mansouri: One thing, the price needs to work. Gulf Distributors quoted us lower last month',
  '03/06/2024, 09:42 - Me: Understood, I hear you on the price. We\'re not just the cheapest though, the support is the difference',
  '03/06/2024, 09:43 - Omar Al Mansouri: I know, that\'s why we\'re still talking 🙂',
  '03/06/2024, 11:02 - Omar Al Mansouri: Btw Yousef handles the technical side for us, he\'ll want to review the integration bits',
  '03/06/2024, 11:03 - Me: Good to know — is Yousef the one who decides on the technical fit?',
  '03/06/2024, 11:05 - Omar Al Mansouri: He advises. Mr Rahman has the final say on budget, he signs everything off',
  '03/06/2024, 11:06 - Me: Understood — noted that Mr Rahman holds the final sign-off.',
  '04/06/2024, 15:20 - Omar Al Mansouri: Any chance of onboarding support included?',
  '04/06/2024, 15:24 - Me: If Mr Rahman approves the premium tier, I could include onboarding — but nothing firm until then.',
  '04/06/2024, 15:25 - Omar Al Mansouri: Noted, let\'s see the numbers first',
  '04/06/2024, 16:48 - Me: <Media omitted>',
  '04/06/2024, 16:49 - Me: There\'s the revised quote. AED 84,000 for the year',
  '04/06/2024, 16:55 - Omar Al Mansouri: خلاص got it, will review with Yousef',
  '04/06/2024, 17:30 - Omar Al Mansouri: Looks good honestly. If we go ahead can you send the signed MSA?',
  '04/06/2024, 17:32 - Me: Absolutely — I\'ll send the signed MSA on the 12th once our legal has countersigned.',
  '05/06/2024, 08:10 - Omar Al Mansouri: Great. We\'re also opening our new Sharjah branch on 20th July, would be good to be live before then',
  '05/06/2024, 08:12 - Me: Noted on the Sharjah branch opening on 20th July.',
  '05/06/2024, 08:15 - Omar Al Mansouri: 👍',
  '05/06/2024, 12:40 - Omar Al Mansouri: Sorry been slammed, my daughter graduates this week so it\'s a bit mad at home',
  '05/06/2024, 12:41 - Me: Congratulations! No rush at all',
  '05/06/2024, 12:42 - Omar Al Mansouri: Thanks 🙏 I\'ll follow up properly after Eid',
  '05/06/2024, 12:43 - Me: Sounds good — I\'ll follow up after Eid to check where you landed.',
  '05/06/2024, 12:44 - Omar Al Mansouri: تمام',
].join('\n');

const OMAR_EXPECTED: Extraction = {
  summary: 'Revised annual quote (AED 84,000) sent to Omar; Yousef advises on technical fit, Mr Rahman holds budget sign-off. Signed MSA to follow; targeting live before the 20 July Sharjah branch opening.',
  promises: [
    { text: 'Send the revised quote', owner: 'rep', due_date: '2024-06-06', due_raw: 'by Thursday', confidence: 'high' },
    // v0.9.4: contingent ("once legal countersigned") + year-less "the 12th" → the engine correctly
    // declines to guess a date and routes to confirmation. due_date null, confidence low.
    { text: 'Send the signed MSA', owner: 'rep', due_date: null, due_raw: 'on the 12th', confidence: 'low' },
    { text: 'Follow up after Eid', owner: 'rep', due_date: null, due_raw: 'after Eid', confidence: 'low' },
    // owner:client — the commitment Omar makes ("I'll follow up properly after Eid"); a promise the
    // rep is OWED. Gives the fixtures explicit owner:client coverage.
    { text: 'Follow up after Eid', owner: 'client', due_date: null, due_raw: 'after Eid', confidence: 'high' },
  ],
  people: [
    // CLIENT-PERSON v0.9.4: Omar is the client AND a person → present; decision_role unknown (Rahman
    // holds the sign-off, so Omar's own authority is not stated). notes null (nothing stated about him).
    { name: 'Omar Al Mansouri', role: null, reports_to: null, decision_role: 'unknown', notes: null },
    { name: 'Yousef', role: 'Technical', reports_to: null, decision_role: 'influencer', notes: 'Handles the technical side; advises' },
    { name: 'Mr Rahman', role: null, reports_to: null, decision_role: 'decision_maker', notes: 'Final say on budget; signs off' },
  ],
  personal_facts: [{ subject: 'Omar Al Mansouri', fact: 'Daughter graduating this week', category: 'family' }],
  key_dates: [{ description: 'Sharjah branch opening', date: '2024-07-20', date_raw: '20th July', type: 'opening' }],
  concerns: ['Price pressure — a competitor (Gulf Distributors) quoted lower'],
  next_steps: [],
  requirements: [],
  meeting: null,
};

// ─────────────────────────────────────────────────────────────────────────────
// A deterministic synthetic transcript builder for the large invariant fixtures.
// Benign, fact-free filler (no dates/names/commitments) so the ONLY extractable facts are the planted
// anchor lines — which makes fabrication trivially detectable. Anchors are inserted verbatim at their
// stated dates; filler is spread across the date range to reach the target message count.
// ─────────────────────────────────────────────────────────────────────────────
export interface AnchorLine { date: string; time: string; sender: string; text: string }

// [FIXTURE-FILLER] Realistic, varied, FACT-FREE chatter — reactions, small talk, logistics, and
// plans that never firm up. Deliberately carries NO extractable fact: no commitment ("I'll…"), no
// date/time, no person name, no stated need. So the only extractable facts in the transcript remain
// the planted anchors — which keeps fabrication obvious — while reading like a real chat rather than
// 5,000 identical "ok"s (the benign filler was a confound that made the hard fixture untrustworthy).
const FILLER = [
  'haha true', 'fair enough', 'exactly', 'no worries', 'all good', 'same here', 'makes sense',
  'ok cool', 'right', 'for sure', 'appreciate it', 'no rush at all', 'whenever works', 'up to you',
  'either is fine by me', 'you there?', 'signal is patchy today', 'long day here', 'how are things',
  'all quiet on my end', 'same old same old', 'busy week', 'finally friday', 'have a good weekend',
  'hope you are keeping well', 'no major news', 'nothing new to report', 'we will see how it goes',
  'still mulling it over', 'back to back all morning', 'stuck in traffic again', 'just got in',
  'heading out shortly', 'on the move right now', 'how was your weekend', 'weekend was quiet thanks',
  'need more coffee', 'typical monday', 'where did the week go', 'good to hear', 'sounds about right',
  'ok noted thanks', 'cheers for that', 'perfect', 'great stuff',
];

/** Deterministic LCG so the fixture is byte-stable across runs. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0xffffffff; };
}

function pad(n: number): string { return String(n).padStart(2, '0'); }

export function synthTranscript(opts: {
  client: string;
  anchors: AnchorLine[];
  totalMessages: number;
  years: number[]; // filler is spread across these years
  seed: number;
}): string {
  const rnd = lcg(opts.seed);
  const lines: Array<{ key: string; line: string }> = [];
  for (const a of opts.anchors) {
    // key = YYYYMMDDHHMM for stable ordering (date is DD/MM/YYYY)
    const [dd, mm, yyyy] = a.date.split('/');
    lines.push({ key: `${yyyy}${mm}${dd}${a.time.replace(':', '')}`, line: `${a.date}, ${a.time} - ${a.sender}: ${a.text}` });
  }
  const fillerCount = Math.max(0, opts.totalMessages - opts.anchors.length);
  for (let i = 0; i < fillerCount; i++) {
    const y = opts.years[Math.floor(rnd() * opts.years.length)]!;
    const mo = 1 + Math.floor(rnd() * 12);
    const d = 1 + Math.floor(rnd() * 28);
    const h = Math.floor(rnd() * 24);
    const mi = Math.floor(rnd() * 60);
    const sender = rnd() < 0.5 ? 'Me' : opts.client;
    const text = FILLER[Math.floor(rnd() * FILLER.length)]!;
    lines.push({ key: `${y}${pad(mo)}${pad(d)}${pad(h)}${pad(mi)}`, line: `${pad(d)}/${pad(mo)}/${y}, ${pad(h)}:${pad(mi)} - ${sender}: ${text}` });
  }
  lines.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return lines.map((l) => l.line).join('\n');
}

// ── Medium — Farah Haddad (~401 msgs, 2024). INVARIANT. ──
const FARAH_ANCHORS: AnchorLine[] = [
  { date: '05/03/2024', time: '10:00', sender: 'Me', text: 'I\'ll send the renewal terms by end of week.' },
  { date: '07/03/2024', time: '09:15', sender: 'Me', text: 'I\'ll get the fleet policy quote over on Monday.' },
  { date: '11/03/2024', time: '14:20', sender: 'Me', text: 'I\'ll email the claims history once Farah sends the schedule.' },
  { date: '12/03/2024', time: '11:05', sender: 'Farah Haddad', text: 'By the way our old broker at Oman Insurance never did this.' },
  { date: '20/03/2024', time: '16:40', sender: 'Farah Haddad', text: 'Khalid is our finance approver, he signs off the premiums.' },
  { date: '21/03/2024', time: '09:30', sender: 'Farah Haddad', text: 'Reem just coordinates the paperwork on our side.' },
  { date: '02/04/2024', time: '13:00', sender: 'Farah Haddad', text: 'The policy renews on 15 June 2024, keep that in mind.' },
  { date: '15/04/2024', time: '10:10', sender: 'Me', text: 'I\'ll share the comparison deck after the board meeting.' },
];
const FARAH_CONTRACT: InvariantContract = {
  id: 'import-medium-farah',
  requiredPromises: [
    { match: 'renewal terms' },
    { match: 'fleet policy quote' },
    { match: 'claims history', dueYear: null },       // conditional on her sending the schedule → no date
    { match: 'comparison deck', dueYear: null },      // "after the board meeting" → no resolvable date
  ],
  requiredPeople: [
    { name: 'Farah Haddad', decisionRole: 'unknown' }, // CLIENT-PERSON v0.9.4: client present, unknown (Khalid signs off)
    { name: 'Khalid', decisionRole: 'decision_maker' },
    { name: 'Reem', decisionRole: 'unknown' },         // "just coordinates" → unknown, not influencer
  ],
  forbiddenEntities: ['Oman Insurance'],              // a prior vendor, not a Farah stakeholder
  requiredDates: [{ match: 'renew', year: 2024 }],
};

// ── Hard — Imtinan Qureshi (~5,615 msgs, 2019→2024). INVARIANT. Multi-year integrity + recall. ──
const IMTINAN_ANCHORS: AnchorLine[] = [
  { date: '14/02/2019', time: '10:00', sender: 'Me', text: 'I\'ll hold that price for you, no change through the year.' }, // H1 never retracted
  { date: '03/05/2021', time: '11:30', sender: 'Me', text: 'I\'ll send the renewal before the 30th.' },                    // H2 (2021)
  { date: '09/06/2022', time: '15:00', sender: 'Me', text: 'I\'ll draft the pilot proposal for the new site.' },           // H3 (about to be retracted)
  { date: '11/06/2022', time: '09:20', sender: 'Me', text: 'Ignore that pilot proposal — we\'re not doing it, scrap it.' }, // H3 retraction
  { date: '18/07/2023', time: '14:45', sender: 'Me', text: 'I\'ll circle back after the summer.' },                        // H4 vague → null
  { date: '05/03/2024', time: '10:30', sender: 'Me', text: 'I\'ll send the updated contract on the 5th.' },                // H5 (2024)
  { date: '20/08/2020', time: '12:00', sender: 'Imtinan Qureshi', text: 'We signed the contract today, 20 August 2020.' }, // date anchor 2020
  { date: '01/09/2023', time: '13:15', sender: 'Imtinan Qureshi', text: 'Our renewal is due 1 September 2023.' },          // date anchor 2023
  { date: '15/03/2019', time: '09:00', sender: 'Imtinan Qureshi', text: 'My colleague Bilal handles procurement, he just advises for now.' },
  { date: '22/11/2023', time: '16:00', sender: 'Imtinan Qureshi', text: 'Bilal now signs off all purchasing decisions here.' }, // role evolves → decision_maker by 2023
  { date: '30/04/2021', time: '10:45', sender: 'Imtinan Qureshi', text: 'A rep from Falcon Traders came by with a cheaper offer, fyi.' }, // competitor trap
];
const IMTINAN_CONTRACT: InvariantContract = {
  id: 'import-hard-imtinan',
  // Promise date note: in a multi-message import the reference date is the LAST message (~2024), and
  // the production DATE-INVARIANT nulls any promise due_date before it — so historical promise dates
  // are clamped to null by design. We therefore assert promise RECALL (found despite depth) + the
  // vague-date trap here, and carry MULTI-YEAR date integrity on key_dates (requiredDates), which are
  // not clamped. A dueYear on a historical promise would fail for a pipeline reason, not a model one.
  // match on keywords present in BOTH the planted line AND the engine's rephrasing (IMPORT-DIAG:
  // "hold that price"→"Hold the client's price"; "circle back after the summer"→"Circle back on the
  // account" / due_raw "after the summer"). Matched across text+due_raw by scoreInvariants.
  requiredPromises: [
    { match: 'hold' },                                // H1 — surfaced despite being 5,000+ msgs deep
    { match: 'renewal' },                             // H2 — recall (date clamped by reference-date rule)
    { match: 'circle back', dueYear: null },          // H4 — vague → null (trap); also clamped
    { match: 'updated contract' },                    // H5
  ],
  forbiddenPromises: [{ match: 'pilot proposal' }],   // H3 retracted — must not surface as open
  requiredPeople: [
    { name: 'Imtinan Qureshi', decisionRole: 'unknown' }, // CLIENT-PERSON v0.9.4: client present, unknown (Bilal signs off)
    { name: 'Bilal', decisionRole: 'decision_maker' }, // latest stated role wins (2023), not 2019 'advises'
  ],
  forbiddenEntities: ['Falcon Traders'],              // competitor named in passing
  requiredDates: [
    { match: 'renewal', year: 2023 },
    { match: 'signed', year: 2020 },                  // "We signed the contract … 20 August 2020" — distinct from the renewal
  ],
};

/**
 * [GATE-IMPORT-SIZE] Recall baseline per fixture (facts/anchors found ÷ expected), from the last
 * certification. Recall is REPORTED not gated (Wabil's condition) — a drop across certs is a real
 * engine-at-scale signal even though it doesn't fail the build. Empty until the first import cert
 * sets it; update it each cert beside the new measurement (same discipline as the published
 * fabrication/precision rates). `null` for a fixture = "no prior; first cert establishes it."
 */
export const RECALL_BASELINES: Record<string, number | null> = {
  'import-easy-omar': 1.0, // v0.9.4 cert 2026-09-09 (GATE_IMPORT_FULL, 3-run)
  'import-medium-farah': 1.0,
  'import-hard-imtinan': 1.0,
};

export const IMPORT_FIXTURES: ImportFixture[] = [
  { id: 'import-easy-omar', mode: 'full', clientName: 'Omar Al Mansouri', today: '2026-09-08', transcript: OMAR_TRANSCRIPT, expected: OMAR_EXPECTED, forbidden: [], tier: 'ci-subset' },
  { id: 'import-medium-farah', mode: 'invariant', clientName: 'Farah Haddad', today: '2026-09-08', transcript: synthTranscript({ client: 'Farah Haddad', anchors: FARAH_ANCHORS, totalMessages: 401, years: [2024], seed: 401 }), contract: FARAH_CONTRACT, tier: 'cert-only' },
  { id: 'import-hard-imtinan', mode: 'invariant', clientName: 'Imtinan Qureshi', today: '2026-09-08', transcript: synthTranscript({ client: 'Imtinan Qureshi', anchors: IMTINAN_ANCHORS, totalMessages: 5615, years: [2019, 2020, 2021, 2022, 2023, 2024], seed: 5615 }), contract: IMTINAN_CONTRACT, tier: 'cert-only' },
];
