import { redactSensitive, type SensitiveKind } from './redact.js';

export interface Tier1Tally {
  /** Occurrences by kind across all scanned text (cards are Luhn-confirmed). */
  byType: Record<SensitiveKind, number>;
  notesScanned: number;
  /** Notes carrying at least one Tier-1 value — the remediation worklist size. */
  notesWithAnyTier1: number;
  total: number;
}

const KINDS: SensitiveKind[] = ['card', 'iban', 'emirates_id', 'swift', 'bank_account', 'passport', 'credential'];

/**
 * Tier-1 backfill tally over existing stored text, using the SAME redactor that protects
 * new data (so a "card" here is Luhn-confirmed, not a bare digit run). Returns aggregate
 * counts ONLY — never the values, never which note. This is the compliance count for
 * pre-redaction data (REDACT-REPORT §7).
 */
export function tallyTier1(texts: string[]): Tier1Tally {
  const byType: Record<SensitiveKind, number> = { card: 0, iban: 0, emirates_id: 0, swift: 0, bank_account: 0, passport: 0, credential: 0 };
  let notesWithAnyTier1 = 0;
  let total = 0;
  for (const text of texts) {
    const { counts, total: t } = redactSensitive(text ?? '');
    if (t > 0) notesWithAnyTier1 += 1;
    total += t;
    for (const k of KINDS) byType[k] += counts[k] ?? 0;
  }
  return { byType, notesScanned: texts.length, notesWithAnyTier1, total };
}
