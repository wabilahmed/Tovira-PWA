import { canonicalPhone } from './phone.js';

/**
 * [P57-4 · owner] Who the rep met, read from a voice transcript with no model call: the confirm step of a voice "new
 * client" pre-fills these and the rep confirms or edits them before anything is created. Deliberately narrow: a name is
 * taken only after a meeting cue ("met", "spoke to", "call with", "the client is" …) and only as capitalised words; a
 * company only right after that name ("from Emaar", "at Tata Motors", "of HDFC Life"); a phone only with its country
 * code (canonicalPhone, never a guessed one). Anything else is null, and the step asks "Who is this client?".
 */
export interface ClientSuggestion { name: string | null; company: string | null; phone: string | null }

const CUE = /\b(?:met(?: up)? with|met|meeting with|spoke (?:to|with)|talked (?:to|with)|(?:a |the )?call with|called|lunch with|coffee with|dinner with|visited|the client is|client is|(?:his|her|their) name is|this is)\s+/gi;
const HONORIFIC = /^(?:mr|mrs|ms|miss|dr|sir|madam|sheikh|shaikh)\.?\s+/i;
const WORD = /^[A-Z][\p{L}'’-]*$/u;
const NOT_A_NAME = new Set(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday', 'Today', 'Yesterday', 'Tomorrow', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December', 'The', 'A', 'An', 'Him', 'Her', 'Them', 'I', 'We', 'You', 'He', 'She', 'They']);
const LINK = new Set(['Al', 'El', 'Bin', 'Bint', 'Ibn', 'Abu', 'Van', 'De', 'Da', 'Di', 'Le', 'La']);

function capitalisedRun(text: string, max: number, allowLink: boolean): { words: string[]; rest: string } {
  const tokens = text.split(/(\s+)/);
  const words: string[] = [];
  let used = 0;
  for (let i = 0; i < tokens.length && words.length < max; i += 2) {
    const raw = tokens[i] ?? '';
    const w = raw.replace(/[.,;:!?)]+$/, '');
    if (!w || !WORD.test(w) || NOT_A_NAME.has(w)) break;
    if (!allowLink && LINK.has(w) && words.length === 0) break;
    words.push(w);
    used = i + 1;
    if (w !== raw) break; // punctuation ends the run ("Omar," / "Emaar,")
  }
  return { words, rest: tokens.slice(used).join('') };
}

export function suggestClientFromTranscript(transcript: string): ClientSuggestion {
  const out: ClientSuggestion = { name: null, company: null, phone: null };
  if (!transcript) return out;
  for (const m of transcript.matchAll(CUE)) {
    const after = transcript.slice(m.index! + m[0].length).replace(HONORIFIC, '');
    const run = capitalisedRun(after, 4, false);
    if (run.words.length === 0) continue;
    out.name = run.words.join(' ');
    const co = /^\s+(?:from|at|of)\s+/.exec(run.rest);
    if (co) {
      const c = capitalisedRun(run.rest.slice(co[0].length), 4, true);
      if (c.words.length) out.company = c.words.join(' ');
    }
    break;
  }
  for (const pm of transcript.matchAll(/\+\d[\d\s-]{6,18}\d/g)) {
    const p = canonicalPhone(pm[0]);
    if (p.ok) { out.phone = p.phone; break; }
  }
  return out;
}
