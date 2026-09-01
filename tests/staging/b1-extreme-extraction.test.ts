/**
 * PART B · B1 — extreme extraction on a dense, code-switched trap note. Scores the LIVE
 * engine against the CERTIFIED answer key in PART-B-B1-SPEC.md (certified 2026-09-01,
 * option A). The point is precision + refusal, not volume (that is B3). Each trap is a
 * soft assertion so one run reports every trap, and the full extraction is logged.
 *
 * A failure here is a FINDING about the engine (e.g. it silently resolved the ambiguous
 * date), not a test to weaken — closing it would be a prompt change + a P1-9 re-cert.
 */
import { describe, it, expect } from 'vitest';
import { useHarness } from './lib/harness.js';
import type { Identity } from './lib/identity.js';

const h = useHarness();

const B1_NOTE =
  'Long day. Wrapped with Khalid at Gulf Petrochem — اجتمعت معاه اليوم, good energy. ' +
  'He confirmed the board approved budget for the Q4 rollout. I told him I\'ll send the ' +
  'revised SOW by this Thursday, and I promised to loop in their procurement lead once ' +
  'it\'s signed. Their CFO, Mona, wants pricing locked before 03/04/2026 — she\'s the one ' +
  'who actually signs off. The current contract renews 17/09/2026, so we have a hard wall ' +
  'there. Site visit is pencilled for the 20th, still needs confirming. We should probably ' +
  'get legal to look over the MSA at some point. Khalid mentioned بنته تخرجت — his daughter ' +
  'graduated — he\'s off to London next week to celebrate.';

interface Extraction {
  summary: string;
  promises: { text: string; owner: string; due_date: string | null; due_raw: string | null; confidence: string }[];
  people: { name: string | null; role: string | null; decision_role: string; notes: string | null }[];
  personal_facts: { subject: string; fact: string; category: string }[];
  key_dates: { description: string; date: string | null; date_raw: string | null; type: string }[];
  concerns: string[];
  next_steps: string[];
  meeting: { datetime: string | null; datetime_raw: string; confirmed: boolean } | null;
}

async function extractB1(rep: Identity, clientId: string): Promise<Extraction> {
  const paste = await rep.http.post<{ id: string }>(`/clients/${clientId}/notes/paste`, { text: B1_NOTE });
  expect(paste.status, `paste: ${rep.http.lastExchange()}`).toBe(201);
  // Trigger extraction; ignore the response (a heavy multilingual note can exceed the
  // gateway — the server-side extraction or the background sweep still completes).
  await rep.http.post(`/notes/${paste.body.id}/extract`).catch(() => undefined);
  const deadline = Date.now() + 150_000;
  for (;;) {
    const res = await rep.http.get<{ notes: Array<{ id: string; status: string; extracted: Extraction | null }> }>(`/clients/${clientId}/notes`);
    const note = res.body.notes.find((n) => n.id === paste.body.id);
    if (note?.status === 'extracted' && note.extracted) return note.extracted;
    if (note?.status === 'needs_review') throw new Error(`B1 note went needs_review — extraction failed: ${rep.http.lastExchange()}`);
    if (Date.now() > deadline) throw new Error(`B1 note still '${note?.status}' after 100s`);
    await new Promise((r) => setTimeout(r, 4000));
  }
}

describe('[PART B · B1] extreme extraction — dense trap note (certified key)', () => {
  it('extracts the certified facts and refuses every trap', async () => {
    // Generous budget: a heavy multilingual note on a cold task (fresh deploy, cold
    // prompt cache) can take ~2 min; extraction is ~20s warm. Asserts correctness, not latency.
    const rep = await h.factory.newRep();
    const c = await rep.http.post<{ id: string }>('/clients', { name: 'Gulf Petrochem' });
    expect(c.status).toBe(201);
    const ex = await extractB1(rep, c.body.id);
    console.log(`  [B1] extraction: ${JSON.stringify(ex)}`);

    // ── THE PLANT: the ambiguous numeric date (03/04/2026) is NEVER silently resolved ──
    const everyDate = [
      ...ex.key_dates.map((k) => k.date),
      ...ex.promises.map((p) => p.due_date),
      ex.meeting?.datetime ?? null,
    ];
    expect.soft(everyDate, 'no field resolves 03/04 as DD/MM (3 Apr)').not.toContain('2026-04-03');
    expect.soft(everyDate, 'no field resolves 03/04 as MM/DD (4 Mar)').not.toContain('2026-03-04');
    const pricing = ex.key_dates.find((k) => (k.date_raw ?? '').includes('03/04') || /pric/i.test(k.description));
    expect.soft(pricing, 'the 03/04 pricing deadline is kept (not dropped)').toBeTruthy();
    if (pricing) expect.soft(pricing.date, 'ambiguous date stays null + raw').toBeNull();

    // ── self-disambiguating numeric (17 forces DD/MM) resolves to 17 Sep 2026 ──
    const renewal = ex.key_dates.find((k) => (k.date_raw ?? '').includes('17/09') || /renew/i.test(k.description));
    expect.soft(renewal, 'the renewal date is extracted').toBeTruthy();
    if (renewal) expect.soft(renewal.date, '17/09/2026 resolves (17 can only be a day)').toBe('2026-09-17');

    // ── year/month-less "the 20th" stays null (in key_dates OR meeting) ──
    const site = ex.key_dates.find((k) => /site|visit/i.test(k.description) || /\bthe 20th\b|\b20th\b/.test(k.date_raw ?? ''));
    if (site) expect.soft(site.date, '"the 20th" stays null (no month/year)').toBeNull();
    else if (ex.meeting) expect.soft(ex.meeting.datetime, 'unconfirmed site visit not date-resolved').toBeNull();

    // ── promises: exactly 2; SOW → a resolved Thursday, high; procurement → null + LOW ──
    expect.soft(ex.promises, 'exactly 2 promises (legal review is NOT one)').toHaveLength(2);
    for (const p of ex.promises) expect.soft(p.owner, `promise owner is rep: "${p.text}"`).toBe('rep');
    const dated = ex.promises.filter((p) => p.due_date !== null);
    const undated = ex.promises.filter((p) => p.due_date === null);
    expect.soft(dated.length, 'one promise has a resolved date (SOW)').toBe(1);
    expect.soft(undated.length, 'one promise has no date (procurement)').toBe(1);
    if (dated[0]) {
      expect.soft(new Date(dated[0].due_date!).getUTCDay(), `SOW "this Thursday" resolves to a Thursday, got ${dated[0].due_date}`).toBe(4);
      expect.soft(dated[0].confidence, 'SOW promise is high-confidence').toBe('high');
    }
    if (undated[0]) {
      expect.soft(undated[0].confidence, 'conditional "once signed" promise is LOW-confidence (→ confirmation queue)').toBe('low');
    }

    // ── no phantom commitment from soft / context lines ──
    const promiseText = ex.promises.map((p) => p.text.toLowerCase()).join(' | ');
    expect.soft(promiseText, 'legal MSA review is a next step, not a promise').not.toMatch(/legal|msa/);
    expect.soft(promiseText, '"board approved budget" is context, not a promise').not.toMatch(/budget|board|approv/);
    expect.soft(ex.next_steps.join(' ').toLowerCase(), 'legal review captured as a next step').toMatch(/legal|msa/);
    expect.soft(ex.concerns.join(' ').toLowerCase(), 'approved budget is not a concern').not.toMatch(/approved budget|budget.*approv/);

    // ── people: Khalid + Mona (CFO / decision-maker); a null name is fine, "" is not ──
    for (const person of ex.people) expect.soft(person.name, 'no empty-string person name (null allowed)').not.toBe('');
    const mona = ex.people.find((p) => /mona/i.test(p.name ?? ''));
    expect.soft(mona, 'Mona extracted').toBeTruthy();
    if (mona) expect.soft(mona.decision_role, 'Mona is the decision-maker').toBe('decision_maker');
    expect.soft(ex.people.some((p) => /khalid/i.test(p.name ?? '')), 'Khalid extracted').toBe(true);

    // ── the London trip is a personal fact, not a resolved date ──
    expect.soft(
      ex.personal_facts.some((f) => /london|graduat/i.test(`${f.subject} ${f.fact}`)),
      'daughter graduation / London trip kept as a personal fact',
    ).toBe(true);

    // Honest outcome for the report: collect the load-bearing certified checks that
    // failed (the soft expects above already make vitest red; this records WHAT missed).
    const findings: string[] = [];
    if (pricing?.date != null) findings.push(`ambiguous 03/04/2026 silently resolved to ${pricing.date} instead of null (FABRICATION class)`);
    if (renewal?.date !== '2026-09-17') findings.push(`17/09/2026 not resolved to 2026-09-17 (got ${renewal?.date ?? 'absent'})`);
    if (ex.promises.length !== 2) findings.push(`promise count ${ex.promises.length} (expected 2)`);
    if (undated[0] && undated[0].confidence !== 'low') findings.push(`conditional promise confidence '${undated[0].confidence}' (expected low)`);
    h.report.record({
      part: 'B',
      flow: 'B1',
      name: 'dense trap note — certified key',
      outcome: findings.length ? 'FAIL' : 'PASS',
      detail: findings.length ? findings.join('; ') : `all traps refused: promises=2 sow=${dated[0]?.due_date} 03/04=null renewal=${renewal?.date}`,
      stopTheLine: pricing?.date != null, // a silently-resolved ambiguous date is the fabrication class the doctrine targets
    });
  }, 180_000);
});
