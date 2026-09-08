/**
 * [GATE-IMPORT-SIZE] DRAFT import-sized gate fixtures — NOT wired into the live gate.
 *
 * The extraction gate (apps/api/src/eval/eval-set.ts) is 47 fixtures of tiny SINGLE notes. That is
 * exactly the blind spot that let the max_tokens starvation reach a blind test: the test data never
 * resembled a real multi-message import. This module drafts the missing regime — import-sized,
 * multi-message transcripts — so B2 can re-certify against reality.
 *
 * WHY THIS IS A DRAFT AND STOPS HERE (two blockers, both Wabil's to clear, per governance):
 *
 *  1. ANSWER KEY HELD BY WABIL. Per the draft-then-certify rule ([[ask-capture-governance]],
 *     [[p1-9-certification-standard]]: "eval fixture is guarded ground truth"), expected outputs for
 *     a gate fixture must be CERTIFIED by a human, never self-approved by the model under test.
 *     Hand-fabricating an `expected: Extraction` for a 5,615-message export spanning 2019→2024 is the
 *     precise fabrication risk the gate exists to catch. So each fixture below carries a structural
 *     CONTRACT (the invariants the extraction must satisfy) but its concrete expected values are
 *     `PENDING_CERTIFICATION` — to be filled from Wabil's held key, then this promoted into eval-set.ts.
 *
 *  2. REAL CUSTOMER TRANSCRIPTS. Omar / Farah / Imtinan are real people's WhatsApp chats. The prior
 *     blind-test batch deliberately kept the .zip/.txt exports UNTRACKED (local only). Whether they
 *     may be committed as permanent repo fixtures — or must be anonymised / synthesised first — is a
 *     privacy decision for Wabil, not the model. So fixtures reference the transcript BY PATH (like
 *     tests/staging/extraction-blind-run.ts), never inline the content.
 *
 * When both are cleared, promote the certified fixtures into EVAL_NOTES with source
 * 'whatsapp_export' and run B2 (the re-cert). Until then the live gate's N is unchanged and green.
 */
import type { Extraction } from '../../apps/api/src/services/extraction/types.js';

/** A gate fixture whose input is a real multi-message import, referenced by path, not inlined. */
export interface ImportGateFixtureDraft {
  id: string;
  /** The export file (untracked, local) this fixture is built from — unzip → resolve → parse → render. */
  transcriptFile: string;
  clientName: string;
  /** The import/reference date fed as `today` — distinct from the in-transcript message dates. */
  today: string;
  /** Measured shape (from the A1 ladder / blind run) so the split below can be reasoned about. */
  measured: { messages: number; inputTokens: number; spans?: string };
  difficulty: 'easy' | 'medium' | 'hard';
  /** Whether this fixture runs on every CI gate or only on a full certification (see SPLIT below). */
  tier: 'ci-subset' | 'cert-only';
  /**
   * The invariants the certified expected output MUST satisfy. These are safe to state now (they are
   * the product's trust rules, not the answer key). The concrete `expected` is filled at certification.
   */
  contract: string[];
  /** Filled from Wabil's held answer key at certification. Left null so this cannot masquerade as certified. */
  expected: Extraction | 'PENDING_CERTIFICATION';
}

const CONTRACT_COMMON = [
  'NO fabricated promise: every promise in `expected` is traceable to an explicit commitment in the transcript.',
  'NO guessed date: due_date/date is null unless the transcript states a resolvable one; due_raw/date_raw keeps the words used.',
  'Dates resolve against the MESSAGE reference date, not the import clock (`today`) — the DATE-REF regression class.',
  'NO merged people: two distinct participants never collapse into one; aliases of the SAME person do (per ALIAS-PARSE).',
  'Attribution stays on THIS client: no fact about another chat/contact leaks onto this record.',
];

export const IMPORT_GATE_FIXTURES_DRAFT: ImportGateFixtureDraft[] = [
  {
    id: 'import-easy-omar',
    transcriptFile: 'WhatsApp_Chat_with_Omar_Al_Mansouri.zip',
    clientName: 'Omar Al Mansouri',
    today: '2026-09-08',
    measured: { messages: 68, inputTokens: 12_077 },
    difficulty: 'easy',
    tier: 'ci-subset', // small + cheap (~AED 0.37 warm/run) → the representative import that runs on every CI gate
    contract: [...CONTRACT_COMMON],
    expected: 'PENDING_CERTIFICATION',
  },
  {
    id: 'import-medium-farah',
    transcriptFile: 'WhatsApp_Chat_with_Farah_Insurance.zip',
    clientName: 'Farah Haddad',
    today: '2026-09-08',
    measured: { messages: 401, inputTokens: 21_152 },
    difficulty: 'medium',
    tier: 'cert-only',
    contract: [...CONTRACT_COMMON],
    expected: 'PENDING_CERTIFICATION',
  },
  {
    id: 'import-hard-imtinan',
    transcriptFile: 'WhatsApp_Chat_with_Bubu_DXB.zip',
    clientName: 'Imtinan Qureshi',
    today: '2026-09-08',
    measured: { messages: 5_615, inputTokens: 170_045, spans: '2019 → 2024' },
    difficulty: 'hard',
    tier: 'cert-only', // near the 200k context limit; ~AED 2.55 warm/run — full-cert only
    contract: [
      ...CONTRACT_COMMON,
      'Multi-YEAR spread: a 2019 message and a 2024 message must not collapse; stated_on tracks each message\'s own date.',
      'Long-transcript recall: a commitment made years ago and never retracted is still surfaced, not lost in the middle.',
    ],
    expected: 'PENDING_CERTIFICATION',
  },
];
