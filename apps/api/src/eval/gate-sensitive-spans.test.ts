import { describe, it, expect } from 'vitest';
import { extractForEval } from './gate.js';
import { EVAL_NOTES } from './eval-set.js';
import type { ModelClient } from '../ports/model.js';

// [P55-3 · owner] Option C in the gate, as in production: a receipt quoting special-category content is dropped (the fact
// stays). The gate stays stricter than production on purpose otherwise: it does not screen the note before the model.
describe('[P55-3] the gate drops a sensitive receipt, like production', () => {
  it('the P54 failure: the person\'s quote of the health message is dropped; the person stays', async () => {
    const n = EVAL_NOTES.find((x) => x.id === 'sc-health-visa-medical')!;
    const out = { summary: 'x', promises: [], key_dates: [], personal_facts: [], concerns: [], next_steps: [], requirements: [], meeting: null,
      people: [{ name: 'Rahul Verma', role: null, reports_to: null, decision_role: 'unknown', notes: null, source_span: '[21/10/2026, 10:00] Rahul Verma: Sir medical report आ गई, hepatitis B positive आया है। Visa process का क्या होगा?', source_message_at: '2026-10-21T10:00' }] };
    const model: ModelClient = { complete: async () => ({ text: JSON.stringify(out) }) };
    const ex = await extractForEval(model, n, { aliases: n.aliases });
    expect(ex!.people.map((p) => p.name)).toEqual(['Rahul Verma']);
    expect((ex!.people[0] as { source_span: string | null }).source_span).toBeNull();
  });
  it('NEGATIVE: the gate does not screen the note itself (stricter than production): the model sees the sensitive text', async () => {
    const n = EVAL_NOTES.find((x) => x.id === 'sc-health-visa-medical')!;
    let seen = '';
    const model: ModelClient = { complete: async (req) => { seen = JSON.stringify(req); return { text: '{}' }; } };
    await extractForEval(model, n, {});
    expect(seen).toContain('hepatitis');
  });
});
