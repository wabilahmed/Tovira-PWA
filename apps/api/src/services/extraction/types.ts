/** The v0.1 extraction schema (see docs/tovira-extraction-prompt.md). */
import type { UnansweredQuestion } from '../import/unanswered.js';

export type PromiseOwner = 'rep' | 'client';
export type Confidence = 'high' | 'low';
export type DecisionRole = 'decision_maker' | 'influencer' | 'blocker' | 'unknown';

export interface ExtractedPromise {
  text: string;
  owner: PromiseOwner;
  due_date: string | null;
  due_raw: string | null;
  confidence: Confidence;
  /** [RECEIPTS-v0.9.5] verbatim source excerpt + source message timestamp (null when the source has
   *  no per-message timestamp — voice/paste). Optional: v0.9.4 output lacks them; v0.9.5 emits them. */
  source_span?: string | null;
  source_message_at?: string | null;
}

export interface ExtractedPerson {
  name: string | null;
  role: string | null;
  reports_to: string | null;
  decision_role: DecisionRole;
  notes: string | null;
  /** [RECEIPTS-v0.9.5] verbatim source excerpt + source message timestamp (null when the source has
   *  no per-message timestamp — voice/paste). Optional: v0.9.4 output lacks them; v0.9.5 emits them. */
  source_span?: string | null;
  source_message_at?: string | null;
}

export interface PersonalFact {
  subject: string;
  fact: string;
  category: string;
  /** [RECEIPTS-v0.9.5] verbatim source excerpt + source message timestamp (null when the source has
   *  no per-message timestamp — voice/paste). Optional: v0.9.4 output lacks them; v0.9.5 emits them. */
  source_span?: string | null;
  source_message_at?: string | null;
}

export interface KeyDate {
  description: string;
  date: string | null;
  date_raw: string | null;
  type: string;
  /** [RECEIPTS-v0.9.5] verbatim source excerpt + source message timestamp (null when the source has
   *  no per-message timestamp — voice/paste). Optional: v0.9.4 output lacks them; v0.9.5 emits them. */
  source_span?: string | null;
  source_message_at?: string | null;
}

/** [REQ-FIELD, v0.9] What the client has STATED they are looking for — never an inferred
 *  preference, a complaint (that is a concern), or a rep speculation. Verbatim phrase kept
 *  for the receipt; conditional/vague needs are confidence:low. Drives inventory matching. */
export interface Requirement {
  text: string;
  requirement_raw: string;
  stated_on: string | null;
  confidence: Confidence;
}

export interface Meeting {
  datetime: string | null;
  datetime_raw: string;
  confirmed: boolean;
  /** [RECEIPTS-v0.9.5] verbatim source excerpt + source message timestamp (null when the source has
   *  no per-message timestamp — voice/paste). Optional: v0.9.4 output lacks them; v0.9.5 emits them. */
  source_span?: string | null;
  source_message_at?: string | null;
}

/** [POINTERS] Which section a pointer belongs to. The second section depends on the deal state (D6):
 *  'close' (open / going-cold → reopen), 'next_opportunity' (won), 'retrospective' (rep-confirmed loss). */
export type PointerSection = 'relationship' | 'close' | 'next_opportunity' | 'retrospective';

/** [POINTERS · D6] Where the deal stands, passed to the extraction so it chooses the right second
 *  section. 'going_cold' covers a silence-inferred loss too (D6: an inferred loss is treated as cold,
 *  never as a rep-confirmed loss / retrospective). 'lost' means ONLY a rep-confirmed loss. */
export type DealState = 'open' | 'going_cold' | 'won' | 'lost';

/** [POINTERS · D3] A pointer's grounding in the client's own messages. There is no stable message id in
 *  this codebase, so — exactly like fact receipts — a cited message is a verbatim span + its timestamp. */
export interface PointerReceipt {
  source_span: string;
  source_message_at: string | null; // null only for an untimestamped note (voice/paste)
}

/** [POINTERS] A relationship/closing pointer grounded in THIS client's messages (D2: specific or
 *  nothing). `receipts` cite the message(s) it came from (D3); `inferred` marks a tone/behaviour
 *  inference vs something stated (D4). Validated + screened by deterministic code before saving. */
export interface Pointer {
  section: PointerSection;
  text: string;
  receipts: PointerReceipt[];
  inferred?: boolean;
}

export interface Extraction {
  summary: string;
  promises: ExtractedPromise[];
  people: ExtractedPerson[];
  personal_facts: PersonalFact[];
  key_dates: KeyDate[];
  concerns: string[];
  next_steps: string[];
  /** [REQ-FIELD, v0.9] Produced by the model from v0.9 on. Optional in the TYPE so the guarded
   *  pre-v0.9 eval ground truth (correctly empty) and older stored extractions still satisfy it;
   *  asExtraction defaults it to []. */
  requirements?: Requirement[];
  meeting: Meeting | null;
  /** [POINTERS] Per-client relationship + closing pointers produced by the model (D1 — same call).
   *  Optional in the TYPE so older stored extractions + the guarded pre-pointers eval ground truth still
   *  satisfy it; asExtraction defaults it to []. Deterministically validated/screened before saving. */
  pointers?: Pointer[];
  // Deterministic post-extraction field (P1-6). NOT produced by the model — the
  // extraction service computes it from a chat export's speaker-attributed
  // messages. Optional: absent/[] for non-chat notes; populated for chat imports.
  unanswered_questions?: UnansweredQuestion[];
}
