/**
 * [P23-B3] Long-chat CANDIDATE fixtures (EXT-10) — NOT the certified eval set; nothing here is wired into
 * the P1-9 gate. Three realistic UAE real-estate WhatsApp exports (Android format, day-first), 250–600
 * messages each, English with Arabic mixed in, with the facts that must survive a long chat written out by
 * hand in `expected`.
 *
 * Each transcript = hand-written PLANTED messages (every fact lives in one of these, verbatim) interleaved
 * with everyday traffic drawn from a fixed bank by a seeded generator (deterministic — same bytes every
 * build). The bank holds NO commitments, needs, budgets, dates or meetings, so a model that extracts
 * anything from it has fabricated it.
 *
 *  1. buyer-ranches — a buyer over 4 months (Feb–Jun 2026): budget changes twice, promises made and kept,
 *     two viewings, a decision date.
 *  2. tenant-renewal — a landlord/tenant renewal (Jun–Sep 2026): lease and notice dates, a rent
 *     negotiation, a four-cheque schedule, and a BROKEN promise (the AC).
 *  3. qa-bulk-long — a RECONSTRUCTION of the 302-message "QA Bulk Long" chat (the original is the test
 *     rep's prod content and is never committed): same shape and the same facts that were missed —
 *     "Final budget is 3.2M, decide by July" and the Creek Harbour 3BR need running through the chat.
 */

export type PromiseStatus = 'open' | 'kept' | 'broken';

export interface ExpectedPromise {
  /** Keywords that must ALL appear (any order, whole words; a word ≥ 4 chars may carry a suffix) in the
   *  extracted promise text or due_raw — robust to the model's rewording. */
  match: string;
  owner: 'rep' | 'client';
  /** Resolved due date, or null when the chat gives none that can be fixed without guessing. */
  due: string | null;
  /** kept = fulfilled later in the chat (must not stay open); broken = not kept by its date (stays open). */
  status: PromiseStatus;
}

export interface LongChatExpected {
  promises: ExpectedPromise[];
  /** The main stated need(s) — substrings that a requirement's text/raw must contain (any one alias). */
  requirements: Array<{ id: string; anyOf: string[] }>;
  /** Budget / price: the CURRENT value must be found; earlier values are history (must not be current). */
  budget: { current: string; history: string[] };
  /** Meetings / viewings: day (YYYY-MM-DD) + a substring of datetime_raw. */
  meetings: Array<{ day: string; anyOf: string[] }>;
  /** Key dates: day + description substrings. `decision` marks the final decision date (pass bar). */
  keyDates: Array<{ day: string | null; anyOf: string[]; decision?: boolean }>;
}

export interface LongChatFixture {
  id: string;
  clientName: string;
  repName: string;
  /** The import's reference date (the day the rep imported it). */
  today: string;
  transcript: string;
  messageCount: number;
  expected: LongChatExpected;
}

// ── deterministic generator ──────────────────────────────────────────────────

/** mulberry32 — tiny seeded PRNG so every build produces the same transcript. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Everyday traffic: no commitments, needs, budgets, dates or meetings. [sender: 'R' rep | 'C' client]. */
const BANK: Array<['R' | 'C', string]> = [
  ['C', 'Morning!'], ['R', 'Morning, hope you had a good weekend'], ['C', 'Thanks 🙏'], ['R', 'Noted 👍'],
  ['C', '<Media omitted>'], ['R', '<Media omitted>'], ['C', 'Nice light in the living room'], ['R', 'Yes it gets the afternoon sun'],
  ['C', 'Traffic on SZR is crazy today'], ['R', 'Always at this time 😅'], ['C', 'الحمد لله all good'], ['R', 'تمام 👍'],
  ['C', 'Sorry, was in a meeting'], ['R', 'No worries'], ['C', 'Ok'], ['R', 'Sure'], ['C', '😂😂'], ['R', 'Haha'],
  ['C', 'How is the community in summer, is it quiet?'], ['R', 'Quite quiet, a lot of families travel'],
  ['C', 'My wife liked the kitchen photos'], ['R', 'It is one of the better layouts'], ['C', 'Ramadan Kareem'], ['R', 'Ramadan Kareem to you and the family'],
  ['C', 'Eid Mubarak!'], ['R', 'Eid Mubarak, عساكم من عواده'], ['C', 'Is the gym in the clubhouse included in the service charge?'],
  ['R', 'Yes, the clubhouse gym is covered'], ['C', 'Good to know'], ['R', 'Let me know if anything else comes up'],
  ['C', 'Kids are on holiday this week so a bit busy'], ['R', 'Enjoy the time with them'], ['C', 'Saw a similar one on Bayut, the photos looked old'],
  ['R', 'Some of those listings are months old'], ['C', 'Makes sense'], ['R', 'إن شاء الله'], ['C', 'Talk later'], ['R', 'Speak soon'],
  ['C', 'Is the road works near the gate finished?'], ['R', 'Mostly, one lane is still closed'], ['C', 'Thanks for the update'],
  ['R', 'Market is busy this month, a lot of viewings'], ['C', 'Everyone is moving it seems'], ['C', 'Can you resend the location pin?'],
  ['R', '<Media omitted>'], ['C', 'Got it'], ['C', 'The parking at the sales centre was full'], ['R', 'It gets busy on weekends'],
  ['C', 'Long day 😩'], ['R', 'Rest well'], ['C', 'مشكور'], ['R', 'العفو'], ['C', 'Did the photos come through?'], ['R', 'Yes, all clear'],
];

interface Planted { day: string; time: string; who: 'R' | 'C'; text: string }

/** DD/MM/YYYY for a YYYY-MM-DD day. */
const dmy = (iso: string): string => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/**
 * Lay the planted messages down on their days and fill every day between first and last with 0–6 bank
 * messages (seeded), until roughly `target` messages. Times are kept monotonic within a day.
 */
function build(opts: { seed: number; rep: string; client: string; start: string; end: string; target: number; planted: Planted[] }): { transcript: string; count: number } {
  const rand = prng(opts.seed);
  const byDay = new Map<string, Planted[]>();
  for (const p of opts.planted) byDay.set(p.day, [...(byDay.get(p.day) ?? []), p]);
  const days: string[] = [];
  for (let t = Date.parse(`${opts.start}T00:00:00Z`); t <= Date.parse(`${opts.end}T00:00:00Z`); t += 86_400_000) days.push(new Date(t).toISOString().slice(0, 10));
  const fillerBudget = Math.max(0, opts.target - opts.planted.length);
  const perDay = fillerBudget / days.length;
  const lines: string[] = [`${dmy(opts.start)}, 08:00 - Messages and calls are end-to-end encrypted. No one outside of this chat, not even WhatsApp, can read or listen to them.`];
  let count = 0;
  let bankIdx = Math.floor(rand() * BANK.length);
  for (const day of days) {
    const planted = (byDay.get(day) ?? []).slice().sort((a, b) => a.time.localeCompare(b.time));
    // A few filler messages, at times that don't collide with the planted ones.
    const n = Math.round(perDay * (0.4 + rand() * 1.2));
    const filler: Planted[] = [];
    for (let i = 0; i < n; i++) {
      const [who, text] = BANK[bankIdx % BANK.length]!;
      bankIdx += 1 + Math.floor(rand() * 3);
      const minutes = 7 * 60 + Math.floor(rand() * 15 * 60);
      filler.push({ day, time: `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`, who, text });
    }
    for (const m of [...planted, ...filler].sort((a, b) => a.time.localeCompare(b.time))) {
      lines.push(`${dmy(day)}, ${m.time} - ${m.who === 'R' ? opts.rep : opts.client}: ${m.text}`);
      count += 1;
    }
  }
  return { transcript: lines.join('\n'), count };
}

// ── 1. buyer over 4 months ───────────────────────────────────────────────────

const BUYER: Planted[] = [
  { day: '2026-02-02', time: '10:12', who: 'C', text: 'Hi Wabil, we are looking for a 3-bedroom villa in Arabian Ranches 3 with a maid\'s room' },
  { day: '2026-02-02', time: '10:15', who: 'C', text: 'Our budget is around 2.5M for now' },
  { day: '2026-02-02', time: '10:20', who: 'R', text: 'Great, I\'ll send you three villa options by Thursday' },
  { day: '2026-02-05', time: '16:40', who: 'R', text: 'Here are the three villa options I promised — Joy, Sun and Spring clusters' },
  { day: '2026-02-05', time: '16:41', who: 'R', text: '<Media omitted>' },
  { day: '2026-02-05', time: '18:02', who: 'C', text: 'Thanks, got them. The Sun one looks best' },
  { day: '2026-03-04', time: '11:30', who: 'R', text: 'Viewing confirmed for Saturday 14/03/2026 at 11am at the Ranches 3 show villa' },
  { day: '2026-03-14', time: '13:05', who: 'C', text: 'Thanks for today, the show villa was great' },
  { day: '2026-03-18', time: '09:45', who: 'C', text: 'After the viewing we can stretch the budget to 2.8M' },
  { day: '2026-03-18', time: '09:50', who: 'R', text: 'Understood. I\'ll share the service charge breakdown for Ranches 3 tomorrow' },
  { day: '2026-03-19', time: '12:10', who: 'R', text: 'As promised, the service charge breakdown for Ranches 3 — about AED 4.5 per sq ft' },
  { day: '2026-03-19', time: '12:11', who: 'R', text: '<Media omitted>' },
  { day: '2026-03-25', time: '19:20', who: 'C', text: 'I\'ll send you my mortgage pre-approval letter next week' },
  { day: '2026-04-02', time: '10:05', who: 'C', text: 'Here is the mortgage pre-approval letter from ENBD' },
  { day: '2026-04-02', time: '10:05', who: 'C', text: '<Media omitted>' },
  { day: '2026-04-22', time: '15:30', who: 'R', text: 'I\'ll ask the developer about the post-handover payment plan and get back to you by Monday' },
  { day: '2026-05-06', time: '20:15', who: 'C', text: 'We spoke as a family — final budget is 3.1M, that is the top' },
  { day: '2026-05-07', time: '09:00', who: 'R', text: 'Second viewing confirmed for Sunday 17/05/2026 at 4pm, Sun cluster villa 22' },
  { day: '2026-05-17', time: '18:30', who: 'C', text: 'Villa 22 is the one. We will decide by 15 June 2026' },
  { day: '2026-05-20', time: '08:40', who: 'C', text: 'Also our current lease ends on 31/07/2026 so timing matters' },
  { day: '2026-06-01', time: '11:00', who: 'C', text: 'Still waiting on the payment plan question from the developer' },
];

const buyer = build({ seed: 23001, rep: 'Wabil', client: 'Khalid Al Suwaidi', start: '2026-02-02', end: '2026-06-05', target: 420, planted: BUYER });

// ── 2. landlord / tenant renewal ─────────────────────────────────────────────

const TENANT: Planted[] = [
  { day: '2026-06-03', time: '10:00', who: 'C', text: 'Hi, our lease on the JVC apartment ends on 30/09/2026 — we want to renew for another 12 months' },
  { day: '2026-06-03', time: '10:02', who: 'C', text: 'We also need covered parking for 2 cars in the renewal' },
  { day: '2026-06-03', time: '10:10', who: 'R', text: 'Noted. Renewal notice has to be given by 02/07/2026, 90 days before the end' },
  { day: '2026-06-03', time: '10:12', who: 'R', text: 'Current rent is 145,000 — I\'ll confirm the landlord\'s number by Wednesday' },
  { day: '2026-06-10', time: '14:20', who: 'R', text: 'Landlord came back: he is asking 160,000 for the renewal' },
  { day: '2026-06-10', time: '14:35', who: 'C', text: 'That is too much, the RERA index for the building says less' },
  { day: '2026-06-15', time: '09:30', who: 'C', text: 'The AC in the master bedroom is leaking again' },
  { day: '2026-06-15', time: '09:40', who: 'R', text: 'I\'ll get the landlord to fix the AC before the end of the month' },
  { day: '2026-06-24', time: '17:00', who: 'R', text: 'Good news, landlord agreed 152,000 for the renewal' },
  { day: '2026-06-24', time: '17:05', who: 'C', text: 'OK we accept 152,000. الحمد لله' },
  { day: '2026-06-24', time: '17:10', who: 'R', text: 'Great, I\'ll send the Ejari renewal form by Sunday' },
  { day: '2026-06-28', time: '11:15', who: 'R', text: 'Here is the Ejari renewal form, please sign page 2' },
  { day: '2026-06-28', time: '11:15', who: 'R', text: '<Media omitted>' },
  { day: '2026-07-02', time: '20:00', who: 'C', text: 'The AC is still not fixed, it has been two weeks' },
  { day: '2026-07-20', time: '13:00', who: 'R', text: 'Rent is in 4 cheques: 01/10/2026, 01/01/2027, 01/04/2027 and 01/07/2027' },
  { day: '2026-07-20', time: '13:20', who: 'C', text: 'I\'ll drop the 4 cheques at your office on 25/09/2026' },
  { day: '2026-08-03', time: '10:30', who: 'R', text: 'Move-in inspection visit is booked for 18/08/2026 at 10am' },
  { day: '2026-08-25', time: '19:45', who: 'C', text: 'AC is still leaking. Very disappointed' },
];

const tenant = build({ seed: 23002, rep: 'Wabil', client: 'Rania Haddad', start: '2026-06-03', end: '2026-09-10', target: 330, planted: TENANT });

// ── 3. QA Bulk Long (reconstruction) ─────────────────────────────────────────

const QA: Planted[] = [
  { day: '2026-05-02', time: '09:14', who: 'C', text: 'Morning — still keen on the 3-bed at Creek Harbour' },
  { day: '2026-05-02', time: '09:15', who: 'R', text: 'Great, pulling the latest availability now' },
  { day: '2026-05-20', time: '12:30', who: 'C', text: 'Any new Creek Harbour 3BR units on high floors?' },
  { day: '2026-06-09', time: '10:00', who: 'C', text: 'We really want the 3BR at Creek Harbour with the creek view' },
  { day: '2026-06-18', time: '17:40', who: 'C', text: 'Final budget is 3.2M, decide by July' },
  { day: '2026-07-01', time: '15:00', who: 'C', text: 'Is the Creek Harbour 3BR on the 28th floor still available?' },
  { day: '2026-07-09', time: '11:02', who: 'C', text: 'We\'ve decided — let\'s move on the Creek Harbour 3BR' },
  { day: '2026-08-01', time: '08:20', who: 'R', text: 'I\'ll send the reservation form today' },
];

const qa = build({ seed: 23003, rep: 'Wabil', client: 'QA Bulk Long', start: '2026-05-02', end: '2026-08-01', target: 316, planted: QA });

export const LONG_CHATS: LongChatFixture[] = [
  {
    id: 'buyer-ranches',
    clientName: 'Khalid Al Suwaidi',
    repName: 'Wabil',
    today: '2026-06-06',
    transcript: buyer.transcript,
    messageCount: buyer.count,
    expected: {
      promises: [
        { match: 'villa options', owner: 'rep', due: '2026-02-05', status: 'kept' },
        { match: 'service charge', owner: 'rep', due: '2026-03-19', status: 'kept' },
        { match: 'pre-approval', owner: 'client', due: null, status: 'kept' },
        { match: 'payment plan', owner: 'rep', due: '2026-04-27', status: 'broken' },
      ],
      requirements: [{ id: '3-bed villa, Arabian Ranches 3, maid\'s room', anyOf: ['ranches 3', 'arabian ranches'] }],
      budget: { current: '3.1M', history: ['2.5M', '2.8M'] },
      meetings: [
        { day: '2026-03-14', anyOf: ['14/03/2026'] },
        { day: '2026-05-17', anyOf: ['17/05/2026'] },
      ],
      keyDates: [
        { day: '2026-06-15', anyOf: ['decide', '15 june'], decision: true },
        { day: '2026-07-31', anyOf: ['lease', '31/07/2026'] },
      ],
    },
  },
  {
    id: 'tenant-renewal',
    clientName: 'Rania Haddad',
    repName: 'Wabil',
    today: '2026-09-11',
    transcript: tenant.transcript,
    messageCount: tenant.count,
    expected: {
      promises: [
        { match: 'landlord number', owner: 'rep', due: '2026-06-10', status: 'kept' }, // "confirm the landlord's number by Wednesday" — answered 10 Jun
        { match: 'fix ac', owner: 'rep', due: '2026-06-30', status: 'broken' },
        { match: 'ejari', owner: 'rep', due: '2026-06-28', status: 'kept' },
        { match: 'cheque', owner: 'client', due: '2026-09-25', status: 'open' },
      ],
      requirements: [{ id: '12-month renewal with covered parking for 2 cars', anyOf: ['parking', 'renew'] }],
      budget: { current: '152,000', history: ['145,000', '160,000'] },
      meetings: [{ day: '2026-08-18', anyOf: ['18/08/2026', 'inspection'] }],
      keyDates: [
        { day: '2026-09-30', anyOf: ['lease', '30/09/2026'] },
        { day: '2026-07-02', anyOf: ['notice', '02/07/2026'], decision: true },
        { day: '2026-10-01', anyOf: ['cheque', '01/10/2026'] },
      ],
    },
  },
  {
    id: 'qa-bulk-long',
    clientName: 'QA Bulk Long',
    repName: 'Wabil',
    today: '2026-08-02',
    transcript: qa.transcript,
    messageCount: qa.count,
    expected: {
      promises: [{ match: 'reservation form', owner: 'rep', due: '2026-08-01', status: 'open' }],
      requirements: [{ id: 'Creek Harbour 3BR', anyOf: ['creek harbour'] }],
      budget: { current: '3.2M', history: [] },
      meetings: [],
      keyDates: [{ day: null, anyOf: ['july', 'decide'], decision: true }],
    },
  },
];
