import type { Extraction } from './types.js';

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

const OWNERS = new Set(['rep', 'client']);
const CONFIDENCES = new Set(['high', 'low']);
const DECISION_ROLES = new Set(['decision_maker', 'influencer', 'blocker', 'unknown']);

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Validate model output against the v0.1 schema. All top-level keys must be
 * present with the right container types; spine entries (promises, people,
 * meeting) are checked field-by-field. Anything off → not ok, and the caller
 * flags the note rather than writing partial/garbage structured data.
 */
export function validateExtraction(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isObj(value)) return { ok: false, errors: ['output is not a JSON object'] };

  if (typeof value.summary !== 'string') errors.push('summary must be a string');

  for (const key of ['promises', 'people', 'personal_facts', 'key_dates', 'concerns', 'next_steps'] as const) {
    if (!Array.isArray(value[key])) errors.push(`${key} must be an array`);
  }

  if (Array.isArray(value.promises)) {
    value.promises.forEach((p, i) => {
      if (!isObj(p)) return errors.push(`promises[${i}] must be an object`);
      if (typeof p.text !== 'string') errors.push(`promises[${i}].text must be a string`);
      if (!OWNERS.has(p.owner as string)) errors.push(`promises[${i}].owner must be rep|client`);
      if (!CONFIDENCES.has(p.confidence as string)) errors.push(`promises[${i}].confidence must be high|low`);
      if (p.due_date !== null && typeof p.due_date !== 'string') errors.push(`promises[${i}].due_date must be string|null`);
    });
  }

  if (Array.isArray(value.people)) {
    value.people.forEach((p, i) => {
      if (!isObj(p)) return errors.push(`people[${i}] must be an object`);
      if (!DECISION_ROLES.has(p.decision_role as string)) errors.push(`people[${i}].decision_role invalid`);
    });
  }

  if (value.meeting !== null) {
    if (!isObj(value.meeting)) {
      errors.push('meeting must be an object or null');
    } else if (typeof value.meeting.confirmed !== 'boolean') {
      errors.push('meeting.confirmed must be a boolean');
    }
  }

  return { ok: errors.length === 0, errors };
}

/** Narrowing helper: returns the value typed as Extraction if it validates. */
export function asExtraction(value: unknown): Extraction | null {
  return validateExtraction(value).ok ? (value as Extraction) : null;
}
