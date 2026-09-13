/**
 * [RECEIPTS-v0.9.5 DRAFT FIXTURES — NOT CERTIFIED, NOT RUN AGAINST THE MODEL]
 *
 * Draft eval fixtures exercising the v0.9.5 per-fact receipt fields (source_span, source_message_at)
 * for the five newly-covered fact types. Two cases per type:
 *   - `clean`: a multi-message whatsapp_export where BOTH fields populate (span quoted verbatim, time
 *     copied from the source message's per-message timestamp);
 *   - `ambiguous`: a paste/voice source with NO per-message timestamp, where source_message_at MUST be
 *     null — never the note's capture time, never today. (source_span can still be the excerpt from the
 *     block; the ambiguity is the timestamp.) This mirrors the live gate's zero tolerance for guessed
 *     dates: absence is null, never a guess.
 *
 * These are DRAFT ground truth: they express the EXPECTED v0.9.5 output, but no one has certified them
 * and the model has not been run against them. They are intentionally NOT imported by eval-set.ts (the
 * guarded, certified answer key) or by the gate. Certification is a separate, credit-gated batch.
 */
import type { PromiseV095, PersonV095, PersonalFactV095, KeyDateV095, MeetingV095 } from '../services/extraction/receipts-v0.9.5-draft.js';

export type V095FactType = 'promise' | 'person' | 'personal_fact' | 'key_date' | 'meeting';
export type V095FixtureKind = 'clean' | 'ambiguous';

export interface V095DraftFixture {
  id: string;
  factType: V095FactType;
  kind: V095FixtureKind;
  today: string;
  clientName: string;
  source: 'voice' | 'paste' | 'whatsapp_export' | 'ask_conversation';
  note: string;
  /** DRAFT expected fact for this fixture. `clean` → both receipt fields non-null; `ambiguous` →
   *  source_message_at null. */
  expected: PromiseV095 | PersonV095 | PersonalFactV095 | KeyDateV095 | MeetingV095;
}

/** DRAFT — pending certification. Do not feed to the gate. */
export const V095_DRAFT_FIXTURES: V095DraftFixture[] = [
  // ---- promise ----
  {
    id: 'v095-promise-clean', factType: 'promise', kind: 'clean', today: '2026-03-15', clientName: 'Omar', source: 'whatsapp_export',
    note: '[2026-03-14T09:00:00Z] Omar: any update on the quote?\n[2026-03-14T09:05:00Z] Me: I’ll send the revised quote by Thursday',
    expected: { text: 'Send the revised quote', owner: 'rep', due_date: null, due_raw: 'Thursday', confidence: 'high', source_span: 'I’ll send the revised quote by Thursday', source_message_at: '2026-03-14T09:05:00Z' },
  },
  {
    id: 'v095-promise-ambiguous-time', factType: 'promise', kind: 'ambiguous', today: '2026-03-15', clientName: 'Omar', source: 'paste',
    note: 'Told Omar I’ll send the revised quote by Thursday.',
    expected: { text: 'Send the revised quote', owner: 'rep', due_date: null, due_raw: 'Thursday', confidence: 'high', source_span: 'I’ll send the revised quote by Thursday', source_message_at: null },
  },
  // ---- person ----
  {
    id: 'v095-person-clean', factType: 'person', kind: 'clean', today: '2026-03-15', clientName: 'Layla', source: 'whatsapp_export',
    note: '[2026-02-11T14:00:00Z] Layla: my husband Karim has the final say on the budget',
    expected: { name: 'Karim', role: null, reports_to: null, decision_role: 'decision_maker', notes: 'final say on the budget', source_span: 'my husband Karim has the final say on the budget', source_message_at: '2026-02-11T14:00:00Z' },
  },
  {
    id: 'v095-person-ambiguous-time', factType: 'person', kind: 'ambiguous', today: '2026-03-15', clientName: 'Layla', source: 'voice',
    note: 'Layla mentioned her husband Karim has the final say on the budget.',
    expected: { name: 'Karim', role: null, reports_to: null, decision_role: 'decision_maker', notes: 'final say on the budget', source_span: 'her husband Karim has the final say on the budget', source_message_at: null },
  },
  // ---- personal_fact ----
  {
    id: 'v095-personalfact-clean', factType: 'personal_fact', kind: 'clean', today: '2026-03-15', clientName: 'Omar', source: 'whatsapp_export',
    note: '[2026-03-03T12:00:00Z] Omar: my daughter just started at LSE, flying over in July',
    expected: { subject: 'Omar', fact: 'daughter just started at LSE', category: 'family', source_span: 'my daughter just started at LSE', source_message_at: '2026-03-03T12:00:00Z' },
  },
  {
    id: 'v095-personalfact-ambiguous-time', factType: 'personal_fact', kind: 'ambiguous', today: '2026-03-15', clientName: 'Omar', source: 'paste',
    note: 'Omar said his daughter just started at LSE.',
    expected: { subject: 'Omar', fact: 'daughter just started at LSE', category: 'family', source_span: 'his daughter just started at LSE', source_message_at: null },
  },
  // ---- key_date ----
  {
    id: 'v095-keydate-clean', factType: 'key_date', kind: 'clean', today: '2026-03-15', clientName: 'Marina Estates', source: 'whatsapp_export',
    note: '[2026-01-20T10:00:00Z] Sara: our renewal is in June, last year the excess was too high',
    expected: { description: 'renewal', date: null, date_raw: 'June', type: 'deadline', source_span: 'our renewal is in June', source_message_at: '2026-01-20T10:00:00Z' },
  },
  {
    id: 'v095-keydate-ambiguous-time', factType: 'key_date', kind: 'ambiguous', today: '2026-03-15', clientName: 'Marina Estates', source: 'voice',
    note: 'Sara said their renewal is in June.',
    expected: { description: 'renewal', date: null, date_raw: 'June', type: 'deadline', source_span: 'their renewal is in June', source_message_at: null },
  },
  // ---- meeting ----
  {
    id: 'v095-meeting-clean', factType: 'meeting', kind: 'clean', today: '2026-03-08', clientName: 'Omar', source: 'whatsapp_export',
    note: '[2026-03-10T15:00:00Z] Omar: locked in for Thursday 3pm at your office',
    expected: { datetime: null, datetime_raw: 'Thursday 3pm', confirmed: true, source_span: 'locked in for Thursday 3pm at your office', source_message_at: '2026-03-10T15:00:00Z' },
  },
  {
    id: 'v095-meeting-ambiguous-time', factType: 'meeting', kind: 'ambiguous', today: '2026-03-08', clientName: 'Omar', source: 'paste',
    note: 'Omar confirmed: locked in for Thursday 3pm at your office.',
    expected: { datetime: null, datetime_raw: 'Thursday 3pm', confirmed: true, source_span: 'locked in for Thursday 3pm at your office', source_message_at: null },
  },
];
