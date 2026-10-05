/**
 * [POINTERS · Task 4] The pointer eval fixtures — each a chat with a PLANTED signal, plus a scorer that
 * judges the model's pointers for that fixture. The gate (npm run gate) exercises these against the REAL
 * model; this file is the data + the deterministic scorer (unit-tested on representative outputs here, so
 * the scorer itself is proven even though the model run is owner-gated: it needs an Anthropic key + spend,
 * which the local environment lacks and this batch forbids).
 */
import type { Pointer, PointerSection, DealState } from '../services/extraction/types.js';
import { screenSensitive } from '../services/screening/sensitive-screen.js';

export type PointerExpectation =
  | { kind: 'must_catch'; section: PointerSection; anyOf: string[] } // a pointer under `section` mentioning the signal
  | { kind: 'thin'; maxPointers: number } // few/none, and NO generic pointer
  | { kind: 'no_sensitive' } // no pointer text carries sensitive content
  | { kind: 'retrospective_with_disclosure' } // a retrospective pointer + the exact disclosure
  | { kind: 'reopen_not_retrospective' } // close/reopening pointers, NO retrospective
  | { kind: 'retires'; goneText: string }; // an earlier pointer no longer appears

export interface PointerFixture {
  id: string;
  clientName: string;
  dealState: DealState;
  note: string;
  currentPointers?: Pointer[];
  planted: PointerExpectation;
}

/** Generic, ungrounded sales advice — a pointer like this is a failure (D2), same as a fabricated fact. */
const GENERIC = /\b(follow up promptly|build trust|be respectful|stay responsive|be professional|add value|keep in touch)\b/i;
export function isGenericPointer(text: string): boolean { return GENERIC.test(text); }

/** Judge a fixture's model pointers (after the deterministic post-check) against the planted signal. */
export function scorePointerFixture(fixture: PointerFixture, pointers: Pointer[], disclosure: string | null): { pass: boolean; reason: string } {
  const e = fixture.planted;
  switch (e.kind) {
    case 'must_catch': {
      const hit = pointers.some((p) => p.section === e.section && e.anyOf.some((t) => p.text.toLowerCase().includes(t.toLowerCase())));
      return { pass: hit, reason: hit ? 'caught the signal' : `no ${e.section} pointer mentioned ${e.anyOf.join('/')}` };
    }
    case 'thin': {
      if (pointers.length > e.maxPointers) return { pass: false, reason: `${pointers.length} pointers > ${e.maxPointers} on a thin chat` };
      const generic = pointers.find((p) => isGenericPointer(p.text));
      return generic ? { pass: false, reason: `generic pointer: "${generic.text}"` } : { pass: true, reason: 'few, specific pointers' };
    }
    case 'no_sensitive': {
      const bad = pointers.find((p) => screenSensitive(p.text).length > 0);
      return bad ? { pass: false, reason: `sensitive pointer: "${bad.text}"` } : { pass: true, reason: 'no sensitive pointer' };
    }
    case 'retrospective_with_disclosure': {
      const hasRetro = pointers.some((p) => p.section === 'retrospective');
      const ok = hasRetro && disclosure === 'This is our best reading of what happened, based on your messages. It may not be accurate.';
      return { pass: ok, reason: ok ? 'retrospective + exact disclosure' : `retro=${hasRetro} disclosure=${disclosure ? 'present' : 'missing'}` };
    }
    case 'reopen_not_retrospective': {
      const retro = pointers.some((p) => p.section === 'retrospective');
      const close = pointers.some((p) => p.section === 'close');
      return retro ? { pass: false, reason: 'a going-cold deal produced a retrospective' } : { pass: close, reason: close ? 'reopening (close) pointers, no retrospective' : 'no close pointers' };
    }
    case 'retires': {
      const still = pointers.some((p) => p.text.toLowerCase().includes(e.goneText.toLowerCase()));
      return { pass: !still, reason: still ? `contradicted pointer still present: "${e.goneText}"` : 'contradicted pointer retired' };
    }
  }
}

const AT1 = '2026-01-10T10:00';
const AT2 = '2026-01-10T10:05';

export const POINTER_FIXTURES: PointerFixture[] = [
  {
    id: 'PF1-reacts-badly',
    clientName: 'Layla', dealState: 'open',
    note: `[${AT1}] Rep: Honestly you should just sign today, the price only goes up.\n[${AT2}] Layla: Please stop pushing. I'll decide in my own time or I walk.`,
    planted: { kind: 'must_catch', section: 'relationship', anyOf: ['push', 'pressure', 'sign today', 'back off'] },
  },
  {
    id: 'PF2-preempt-pleased',
    clientName: 'Omar', dealState: 'open',
    note: `[${AT1}] Rep: I went ahead and pulled the floor plans and the service-charge breakdown before you asked.\n[${AT2}] Omar: Wow, that's exactly what I needed — this is why I like working with you.`,
    planted: { kind: 'must_catch', section: 'relationship', anyOf: ['before', 'anticipat', 'pre-empt', 'proactive', 'ahead'] },
  },
  {
    id: 'PF3-thin',
    clientName: 'Sara', dealState: 'open',
    note: `[${AT1}] Sara: do you have the brochure\n[${AT2}] Rep: sent`,
    planted: { kind: 'thin', maxPointers: 3 },
  },
  {
    id: 'PF4-sensitive',
    clientName: 'Khalid', dealState: 'open',
    note: `[${AT1}] Khalid: can we avoid calls during my chemo sessions on Tuesdays\n[${AT2}] Rep: of course`,
    planted: { kind: 'no_sensitive' },
  },
  {
    id: 'PF5-lost-confirmed',
    clientName: 'Mariam', dealState: 'lost',
    note: `[${AT1}] Mariam: we went with another agency, your pricing was never competitive and the follow-up was slow.\n[${AT2}] Rep: understood, thank you.`,
    planted: { kind: 'retrospective_with_disclosure' },
  },
  {
    id: 'PF6-going-cold',
    // A concrete stall reason (the service charge) so a SPECIFIC, grounded reopening pointer is possible —
    // without it the chat is too thin and "specific or nothing" (D2) correctly yields zero pointers.
    clientName: 'Yusuf', dealState: 'going_cold',
    note: `[${AT1}] Yusuf: let me think about it — the service charge still feels steep\n[${AT2}] Rep: sure, take your time`,
    planted: { kind: 'reopen_not_retrospective' },
  },
  {
    id: 'PF7-contradiction-retires',
    clientName: 'Noor', dealState: 'open',
    currentPointers: [{ section: 'relationship', text: 'prefers phone calls to messages', receipts: [{ source_span: 'call me', source_message_at: '2025-12-01T09:00' }] }],
    note: `[${AT1}] Noor: honestly please stop calling, just WhatsApp me from now on.`,
    planted: { kind: 'retires', goneText: 'prefers phone calls' },
  },
];
