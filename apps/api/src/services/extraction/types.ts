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
}

export interface ExtractedPerson {
  name: string | null;
  role: string | null;
  reports_to: string | null;
  decision_role: DecisionRole;
  notes: string | null;
}

export interface PersonalFact {
  subject: string;
  fact: string;
  category: string;
}

export interface KeyDate {
  description: string;
  date: string | null;
  date_raw: string | null;
  type: string;
}

export interface Meeting {
  datetime: string | null;
  datetime_raw: string;
  confirmed: boolean;
}

export interface Extraction {
  summary: string;
  promises: ExtractedPromise[];
  people: ExtractedPerson[];
  personal_facts: PersonalFact[];
  key_dates: KeyDate[];
  concerns: string[];
  next_steps: string[];
  meeting: Meeting | null;
  // Deterministic post-extraction field (P1-6). NOT produced by the model — the
  // extraction service computes it from a chat export's speaker-attributed
  // messages. Optional: absent/[] for non-chat notes; populated for chat imports.
  unanswered_questions?: UnansweredQuestion[];
}
