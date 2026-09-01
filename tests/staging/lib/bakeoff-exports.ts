import type { ExportSpec } from './planting.js';

/**
 * The five-export bake-off ladder (Part 2, Task 5). Ground truth by construction: the
 * answer key each export yields IS these plants. `today` is pinned per export so
 * relative dates resolve deterministically. Escalating length + difficulty.
 *
 * Relative-date resolutions from today = 2026-09-01 (a Tuesday):
 *   this Friday = 2026-09-04 · next Thursday = 2026-09-10 · in two weeks = 2026-09-15
 */
const TODAY = '2026-09-01';

export const EXPORTS: ExportSpec[] = [
  // ── Export 1 — baseline. Both models must ace it. ──
  {
    id: 'export-1',
    today: TODAY,
    approxLines: 50,
    languages: ['en'],
    fillerLangs: ['en'],
    certifiedLanguages: ['en'],
    promises: [
      { text: 'Send the pricing proposal', owner: 'rep', dueDate: '2026-09-04', dueRaw: 'this Friday', confidence: 'high', sender: 'Me', line: "Great — I'll send the pricing proposal this Friday." },
    ],
    people: [
      { name: 'Omar', sender: 'Client', line: 'Omar here from procurement, thanks for the call.' },
      { name: 'Layla', sender: 'Client', line: 'My manager Layla will want to see the numbers too.' },
    ],
    keyDates: [],
    traps: [{ kind: 'explicit-date', note: 'this Friday → 2026-09-04, high confidence' }],
  },

  // ── Export 2 — relative date, soft next-step, role-only. ──
  {
    id: 'export-2',
    today: TODAY,
    approxLines: 300,
    languages: ['en', 'arz'],
    fillerLangs: ['en', 'arz'],
    certifiedLanguages: ['en', 'arz'],
    promises: [
      { text: 'Send the revised contract', owner: 'rep', dueDate: '2026-09-10', dueRaw: 'next Thursday', confidence: 'high', sender: 'Me', line: "I'll get you the revised contract next Thursday." },
    ],
    people: [{ name: 'Yusuf', sender: 'Client', line: 'Yusuf from the Dubai office joining this thread.' }],
    keyDates: [],
    traps: [
      { kind: 'relative-date', note: 'next Thursday → 2026-09-10' },
      { kind: 'soft-next-step', note: '"we should probably loop in procurement at some point" → next_step, NOT a promise' },
      { kind: 'role-only', note: '"their finance lead hasn\'t approved" → NO person (role only); a concern' },
    ],
  },

  // ── Export 3 — ambiguous numeric date (v0.6), similar names (no-merge), unanswered Q. ──
  {
    id: 'export-3',
    today: TODAY,
    approxLines: 1500,
    languages: ['en', 'ar'],
    fillerLangs: ['en', 'ar'],
    certifiedLanguages: ['en', 'ar'],
    promises: [
      { text: 'Send the signed SOW', owner: 'rep', dueDate: '2026-09-15', dueRaw: 'in two weeks', confidence: 'high', sender: 'Me', line: "wa I'll send the signed SOW in two weeks, ان شاء الله." },
    ],
    people: [
      { name: 'Sara', sender: 'Client', line: 'Sara from finance flagged one thing.' },
      { name: 'Sarah', sender: 'Client', line: 'Also Sarah (different Sarah!) in legal has a question.' },
    ],
    keyDates: [
      { description: 'CFO wants pricing locked before this date', date: null, dateRaw: '05/06/2026', line: 'CFO says lock the pricing before 05/06/2026 please.', sender: 'Client' },
    ],
    traps: [
      { kind: 'ambiguous-date', note: '05/06/2026 both components ≤12 → date NULL + raw kept (v0.6 rule); resolving it is a guessed date' },
      { kind: 'no-merge', note: 'Sara and Sarah are DISTINCT people — must not merge' },
      { kind: 'unanswered', note: 'client asks "can you also cover onboarding?" and the rep never answers → an unanswered question, NOT a promise' },
    ],
    extraLines: [{ sender: 'Client', message: 'quick one — can you also cover onboarding in the SOW? هل ممكن؟' }],
  },

  // ── Export 4 — supersession, conditional, negation, third-party, Arabic-Indic, mixed formats. ──
  {
    id: 'export-4',
    today: TODAY,
    approxLines: 5000,
    languages: ['en', 'ar', 'hi', 'ur'],
    fillerLangs: ['en', 'ar', 'hi', 'ur'],
    certifiedLanguages: ['en', 'ar', 'hi', 'ur'],
    promises: [
      // Supersession: the Thursday SOW is retracted; live state is a low-confidence conditional.
      { text: 'Send the SOW once legal clears the new clause', owner: 'rep', dueDate: null, dueRaw: 'once legal clears', confidence: 'low', sender: 'Me', line: "I said I'd send the SOW Thursday, bas then we agreed to hold off until legal clears the new clause." },
      // Conditional promise → low.
      { text: 'Start onboarding once the PO comes through', owner: 'rep', dueDate: null, dueRaw: 'once the PO comes through', confidence: 'low', sender: 'Me', line: 'once the PO comes through I will kick off onboarding.' },
    ],
    people: [{ name: 'Ahmed', sender: 'Client', line: 'Ahmed said his boss wants the enterprise tier — third-party, boss is unnamed.' }],
    keyDates: [
      { description: 'Contract renewal (hard deadline)', date: '2026-08-22', dateRaw: '22/08/2026', line: 'renewal is 22/08/2026 — hard wall (22 forces DD/MM).', sender: 'Client' },
    ],
    traps: [
      { kind: 'supersession', note: 'retracted Thursday SOW must NOT be an active dated promise; live state = low conditional, no Thursday' },
      { kind: 'conditional', note: 'onboarding "once the PO comes through" → promise, confidence low, null date' },
      { kind: 'negation', note: '"I did NOT promise them a discount" → no discount promise fabricated' },
      { kind: 'third-party', note: "Ahmed's boss is unnamed (role) → not a null-named person" },
      { kind: 'arabic-indic-numerals', note: 'a date written in ٢٢/٠٨/٢٠٢٦ must not break date handling' },
      { kind: 'self-disambiguating-date', note: '22/08/2026 → 2026-08-22 (22 can only be a day)' },
    ],
    extraLines: [
      { sender: 'Me', message: 'to be clear, I did NOT promise them any discount — negation, no discount promise.' },
      { sender: 'Client', message: 'renewal بتاريخ ٢٢/٠٨/٢٠٢٦ برضه — Arabic-Indic form of the same date.' },
    ],
  },

  // ── Export 5 — scale (absorbs B3): needle, near-duplicate, deleted/edited, media. ──
  {
    id: 'export-5',
    today: TODAY,
    approxLines: 10000,
    languages: ['en', 'ar', 'hi', 'ur', 'ru', 'tl'],
    fillerLangs: ['en', 'ar', 'hi', 'ur', 'ru', 'tl'],
    certifiedLanguages: ['en', 'ar', 'hi', 'ur'], // RU + TL are UNCERTIFIED — scored separately
    needleAtLine: 8000,
    promises: [
      { text: 'Send the integration timeline', owner: 'rep', dueDate: '2026-09-04', dueRaw: 'this Friday', confidence: 'high', sender: 'Me', line: "I'll send the integration timeline this Friday." },
      // Near-duplicate of the SAME commitment later in the thread → one promise, not two.
      { text: 'Send the integration timeline', owner: 'rep', dueDate: '2026-09-04', dueRaw: 'this Friday', confidence: 'high', sender: 'Me', line: 'just to confirm, integration timeline coming your way this Friday.' },
    ],
    people: [{ name: 'Priya', sender: 'Client', line: 'Priya from their side, decision maker on vendors.' }],
    keyDates: [],
    traps: [
      { kind: 'needle', note: 'at ~line 8000: "office moved to Sheikh Zayed Road, tower 3" — must be recallable' },
      { kind: 'near-duplicate', note: 'the integration-timeline commitment appears twice → ONE promise, not two' },
      { kind: 'deleted', note: '"This message was deleted" lines carry no fact' },
      { kind: 'media', note: '"<Media omitted>" lines carry no fact' },
      { kind: 'scale-drain', note: 'the sweep must drain the WHOLE import; scheduled_job_runs must not report ok on a partial drain' },
    ],
    extraLines: [
      { sender: 'Client', message: 'This message was deleted' },
      { sender: 'Client', message: '<Media omitted>' },
      { sender: 'Me', message: 'This message was deleted' },
    ],
  },
];
