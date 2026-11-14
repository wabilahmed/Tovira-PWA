import { describe, it, expect } from 'vitest';
import { cutText, blankQuote, cutPregnancy, cutPregnancyPointers, mentionsPregnancy, isPregnancyDueDate, HEALTH_MARKER } from './pregnancy-cut.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NARROW_SURFACE, CERT_SURFACE, GATE_ENTRY_FILES } from '../../eval/extraction-fingerprint.js';

/**
 * [P69-14 · owner] Pregnancy, expecting, a baby on the way, maternity/paternity plans, fertility and IVF are health
 * data. Doctrine: "Tovira may remove words for safety, never add or change them."
 */
const words = (s: string): string[] => s.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
/** a is an in-order subsequence of b: nothing added, reworded or reordered. */
function isSubsequence(a: string[], b: string[]): boolean {
  let j = 0;
  for (const w of a) { while (j < b.length && b[j] !== w) j++; if (j === b.length) return false; j++; }
  return true;
}

const SENSITIVE = [
  'Expecting a baby', 'Expecting a baby; will want hybrid option afterward', 'Hybrid work arrangement after the baby',
  'Hybrid arrangement after having the baby', 'Wants hybrid after the baby', 'Expecting a baby and wants hybrid',
  'Wife is pregnant with their second, loves the beach', 'Wants hybrid after her maternity leave', 'Going on maternity leave in May',
  'They are trying for a baby but want a bigger flat', 'We are expecting in March', 'IVF next month', 'Baby on the way, so wants a bigger garden',
  'Husband on paternity leave until June', 'Doing fertility treatment', 'Pregnancy going well', 'Their baby is due in April - wants to close before',
  'Once the baby arrives, they want a villa near Jumeirah', 'Expecting twins; prefers calls after 6pm',
];
const ORDINARY = [
  'Daughter starts at LSE in September', 'Castellan board meeting - proposal wanted in front of them', 'Expecting the proposal by Friday',
  'Has a baby daughter', 'Loves the beach', 'Anniversary is in May; wife loved an emerald set', 'Expecting a call from the bank', 'Not looking to move right now',
  'Wants hybrid, three days in the office max', "With the school run I'd want hybrid, three days in the office max",
];

describe('[P69-14] cutText: cut only, never add', () => {
  it.each([
    ['Expecting a baby', null],
    ['Expecting a baby; will want hybrid option afterward', 'will want hybrid option afterward'],
    ['Hybrid work arrangement after the baby', 'Hybrid work arrangement'],
    ['Hybrid arrangement after having the baby', 'Hybrid arrangement'],
    ['Wants hybrid after the baby', 'Wants hybrid'],
    ['Expecting a baby and wants hybrid', 'wants hybrid'],
    ['Wife is pregnant with their second, loves the beach', 'loves the beach'],
    ['Wants hybrid after her maternity leave', 'Wants hybrid'],
    ['Going on maternity leave in May', null],
    ['IVF next month', null],
    ['Once the baby arrives, they want a villa near Jumeirah', 'they want a villa near Jumeirah'],
    ['Expecting twins; prefers calls after 6pm', 'prefers calls after 6pm'],
  ])('%s → %s', (input, out) => {
    expect(cutText(input)).toBe(out);
  });

  it('leaves text that does not mention pregnancy byte-identical', () => {
    for (const t of ORDINARY) { expect(mentionsPregnancy(t)).toBe(false); expect(cutText(t)).toBe(t); }
  });

  it('every sensitive example is caught, and what survives no longer mentions it', () => {
    for (const t of SENSITIVE) {
      expect(mentionsPregnancy(t), t).toBe(true);
      const out = cutText(t);
      if (out !== null) expect(mentionsPregnancy(out), out).toBe(false);
    }
  });

  it('a cut never adds, rewords or reorders a word', () => {
    for (const t of [...SENSITIVE, ...ORDINARY]) {
      const out = cutText(t);
      if (out !== null) expect(isSubsequence(words(out), words(t)), `${t} → ${out}`).toBe(true);
    }
  });

  it('a blanked quote adds nothing but the marker', () => {
    const marker = words(HEALTH_MARKER).join(' ');
    for (const t of [...SENSITIVE, ...ORDINARY, "after the baby I'd want hybrid"]) {
      const out = blankQuote(t);
      const rest = words(out.split(HEALTH_MARKER).join(' '));
      expect(isSubsequence(rest, words(t)), `${t} → ${out}`).toBe(true);
      expect(words(out).join(' ').includes(marker) || out === t).toBe(true);
    }
  });
});

describe('[P69-14] cutPregnancy on an extraction', () => {
  it('drops a pregnancy key date, keeps an ordinary one byte-identical, and never drops a quote', () => {
    const anniversary = { description: "Omar Haddad's anniversary", date: null, date_raw: 'May', type: 'anniversary', source_span: 'our anniversary is in May' };
    const ex = {
      personal_facts: [{ subject: 'Omar', fact: 'Wife loved the emerald set', category: 'family', source_span: 'she loved the emerald set, she is pregnant' }],
      key_dates: [{ description: 'Baby due', date: null, date_raw: 'March', type: 'other', source_span: 'the baby is due in March' }, anniversary],
      requirements: [], concerns: [], people: [], promises: [], meeting: null,
    };
    const counts = cutPregnancy(ex);
    expect(ex.key_dates).toEqual([anniversary]);
    expect(ex.personal_facts[0]!.source_span).toBe(`she loved the emerald set, ${HEALTH_MARKER}`);
    expect(counts).toEqual({ dropped: 1, cut: 0, quotesBlanked: 1, promisesBlanked: 0 }); // [P69-17] + promisesBlanked
  });

  it('drops a fact whose subject is the pregnancy', () => {
    const ex = { personal_facts: [{ subject: "Sana's pregnancy", fact: 'Going well', category: 'family' }] };
    cutPregnancy(ex);
    expect(ex.personal_facts).toEqual([]);
  });

  it('pointers: an all-pregnancy pointer is dropped, a mixed one cut', () => {
    const r = [{ source_span: "after the baby I'd want hybrid" }];
    const { pointers } = cutPregnancyPointers([{ text: 'Expecting a baby', receipts: r }, { text: 'Offer hybrid after the baby', receipts: r }, { text: 'Loves the beach', receipts: [{ source_span: 'loves the beach' }] }]);
    expect(pointers.map((p) => p.text)).toEqual(['Offer hybrid', 'Loves the beach']);
  });
});

describe('[P69-14] the block lives outside the certified surfaces', () => {
  it('is in neither CERT_SURFACE nor NARROW_SURFACE (the window and certification keys), and the gate never calls it', () => {
    const f = 'services/privacy/pregnancy-cut.ts';
    expect(CERT_SURFACE).not.toContain(f);
    expect(NARROW_SURFACE).not.toContain(f);
    // The gate imports one date helper from extraction-service.ts, so it loads this file, but it never calls the block:
    // what the gate scores is the certified extraction before this store-time cut.
    const src = fileURLToPath(new URL('../../', import.meta.url));
    for (const g of GATE_ENTRY_FILES) expect(readFileSync(src + g, 'utf8')).not.toMatch(/cutPregnancy|pregnancy-cut/);
    // and the block does not reach into a certified file either
    const self = readFileSync(fileURLToPath(new URL('./pregnancy-cut.ts', import.meta.url)), 'utf8');
    expect(self).not.toMatch(/from '\.\.\/extraction\//);
  });
});

describe('[P69-17 · owner] promise text is blanked, a bare "Due date" is a pregnancy date', () => {
  it('blanks the pregnancy clause in a promise with the marker; never drops or shortens the commitment', () => {
    const ex = { promises: [
      { text: 'Send flowers when the baby arrives', source_span: null },
      { text: 'Send the proposal by Friday', source_span: null },
    ] };
    const counts = cutPregnancy(ex);
    expect(ex.promises.map((p) => p.text)).toEqual([`Send flowers ${HEALTH_MARKER}`, 'Send the proposal by Friday']);
    expect(counts.promisesBlanked).toBe(1);
  });

  it.each([
    ['Due date', 'other', true], ['due date', 'birthday', true], ["Her due date", 'other', true], ["The baby's due date", 'other', true],
    ['Due date', 'deadline', false], ['Due date', 'launch', false], ['Payment due date', 'other', false], ['Invoice due date', 'deadline', false], ['Due date for the deposit', 'other', false],
  ])('%s (%s) → %s', (d, t, out) => {
    expect(isPregnancyDueDate(d, t)).toBe(out);
  });

  it('drops a personal "Due date" key date and keeps a deadline one', () => {
    const deadline = { description: 'Due date', date: null, date_raw: 'the 30th', type: 'deadline' };
    const ex = { key_dates: [{ description: 'Due date', date: null, date_raw: 'March', type: 'other' }, deadline] };
    cutPregnancy(ex);
    expect(ex.key_dates).toEqual([deadline]);
  });
});
