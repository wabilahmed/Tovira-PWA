/**
 * Fixtures. Ground truth is NOT invented here (rail #4): the known-extraction data
 * is REUSED from the P1-9 eval set (apps/api/src/eval/eval-set.ts). This module only
 * (a) re-exports selected eval notes by id, (b) renders them into a valid WhatsApp
 * export .txt, and (c) supplies a couple of paste fixtures for verbatim-storage tests.
 * The heavyweight planted-fact generator for Part B lives under tests/extreme/.
 */
import { EVAL_NOTES } from '../../../apps/api/src/eval/eval-set.js';
import type { Extraction } from '../../../apps/api/src/services/extraction/types.js';

export interface EvalNoteLike {
  id: string;
  today: string;
  clientName: string;
  source: 'voice' | 'paste';
  note: string;
  expected: Extraction;
  multilingual?: boolean;
  mustNotMerge?: Array<[string, string]>;
}

const byId = new Map<string, EvalNoteLike>(EVAL_NOTES.map((n) => [n.id, n as EvalNoteLike]));

export function evalNote(id: string): EvalNoteLike {
  const n = byId.get(id);
  if (!n) throw new Error(`eval note "${id}" not found — the eval set changed; do not invent ground truth`);
  return n;
}

export const allEvalNotes = EVAL_NOTES as readonly EvalNoteLike[];

/** The trap notes the harness leans on, each reused from the eval set verbatim. */
export const TRAP_NOTES = {
  firmPromise: 'firm-promise-resolvable-date', // clear promise + resolvable date
  yearlessDate: 'unresolved-vague-date', // date must stay null, raw phrase kept
  codeSwitch: 'arabic-english-resolvable', // Arabic/English code-switch, resolvable
  roleOnly: 'role-only-buyer-cfo', // role-only → no null-named person
  similarNames: 'two-similar-names', // Sarah/Sara must not merge
} as const;

/** Paste fixtures for verbatim-storage tests (emoji + line breaks must survive). */
export const PASTE_FIXTURES = {
  emojiMultiline: 'Met Omar today 👍\nHe wants the revised quote by Friday.\nAlso asked about volume pricing 📊',
  plain: 'Quick call with the buyer — they are happy with the demo and moving to procurement.',
} as const;

interface RenderedLine {
  sender: string;
  ts: string; // "DD/MM/YYYY, HH:MM:SS"
  text: string;
}

/**
 * Render a valid WhatsApp export (`[DD/MM/YYYY, HH:MM:SS] Sender: msg`) from a list of
 * eval-note ids. The client speaks the note's text; ground truth is the union of each
 * note's `expected`. Deterministic timestamps (one day apart) so dates are stable.
 */
export function whatsappExportFromEval(
  clientName: string,
  noteIds: string[],
  startMs = Date.parse('2026-06-01T09:00:00Z'),
): { text: string; groundTruth: EvalNoteLike[] } {
  const groundTruth = noteIds.map(evalNote);
  const lines: RenderedLine[] = [];
  const enc = 'Messages and calls are end-to-end encrypted. No one outside of this chat, not even WhatsApp, can read or listen to them.';
  lines.push({ sender: clientName, ts: fmt(startMs), text: enc });
  groundTruth.forEach((n, i) => {
    const when = startMs + (i + 1) * 24 * 60 * 60 * 1000;
    // Alternate speakers so both sides appear; the note text carries the fact.
    lines.push({ sender: i % 2 === 0 ? clientName : 'Me', ts: fmt(when), text: n.note });
  });
  const text = lines.map((l) => `[${l.ts}] ${l.sender}: ${l.text.replace(/\n/g, ' ')}`).join('\n');
  return { text, groundTruth };
}

function fmt(ms: number): string {
  const d = new Date(ms);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}, ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}
