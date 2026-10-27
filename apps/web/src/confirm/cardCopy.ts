/**
 * [P39-6] What each "Needs your answer" card says: a question (ending in "?"), one line on what Yes does, and the
 * two answers. One function per card type, so the wording lives in one place and is tested. Built only from what
 * is stored: the client's name, the promise's own text, the rep's own statement, the server's reason line.
 * Never a pronoun guessed from a name ("their", not "her"); budgets always carry AED.
 */
export interface CardCopy {
  question: string;
  consequence: string;
  yes: string;
  no: string;
}

/** "2.2M" → "AED 2.2M"; a value that already names AED is left as said. */
export function withAed(value: string): string {
  return /\baed\b/i.test(value) ? value : `AED ${value}`;
}

/** Lower-case the first letter for use mid-sentence — unless the first word is an acronym ("ID photos"). */
function midSentence(text: string): string {
  const t = text.trim().replace(/[.!]+$/, '');
  const first = t.split(/\s+/)[0] ?? '';
  return first.length > 1 && first === first.toUpperCase() ? t : t.charAt(0).toLowerCase() + t.slice(1);
}

/** A held statement that sets a known field: "Did Sara Khan's budget change to AED 2.2M?" — and, when the value it
 *  would replace is stored, [P40-3 · owner] "Did Sara Khan's budget change from AED 2M to AED 2.2M?". */
export function fieldCopy(clientName: string, field: string, value: string, previous?: string | null): CardCopy {
  const money = field === 'budget' || field === 'price';
  const said = money ? withAed(value) : value;
  const was = previous ? (money ? withAed(previous) : previous) : null;
  return {
    question: was ? `Did ${clientName}'s ${field} change from ${was} to ${said}?` : `Did ${clientName}'s ${field} change to ${said}?`,
    consequence: `Yes updates their ${field}.`,
    yes: 'Yes, update it',
    no: 'No',
  };
}

/** A held statement with no known field: asks about the note as a whole (the receipt shows the words). */
export function noteCopy(clientName: string): CardCopy {
  return {
    question: `Save this note about ${clientName}?`,
    consequence: 'Yes adds it to what Tovira knows about them.',
    yes: 'Yes, save it',
    no: 'No',
  };
}

/** A promise the client made: "Did QA P14 Gate Client promise to send ID photos?" */
export function clientPromiseCopy(clientName: string, text: string): CardCopy {
  return {
    question: `Did ${clientName} promise to ${midSentence(text)}?`,
    consequence: 'Yes adds it to their promises.',
    yes: 'Yes, track it',
    no: 'No',
  };
}

/** A promise the rep made: "Did you promise QA Ahmed Al Mansouri the Arabian Ranches shortlist?" ("Send …" reads
 *  as the thing promised); otherwise "Did you promise Omar you'd call the developer?". No client → "Did you promise
 *  to …?". */
export function repPromiseCopy(clientName: string | null, text: string): CardCopy {
  const t = midSentence(text);
  const sent = /^(send|share|give)\s+(.+)$/i.exec(t);
  const question = !clientName
    ? `Did you promise to ${t}?`
    : sent
      ? `Did you promise ${clientName} ${sent[2]}?`
      : `Did you promise ${clientName} you'd ${t}?`;
  return { question, consequence: 'Yes adds it to your promises.', yes: 'Yes, track it', no: 'No' };
}

/** A delivery seen in the chat: "Looks like you sent the options. Mark it done?" The server's line already ends
 *  "Mark done?" — that tail is replaced, never doubled. */
export function keptCopy(message: string): CardCopy {
  const lead = message.trim().replace(/\s*Mark (it )?done\?$/i, '').replace(/[.!?]+$/, '');
  return {
    question: `${lead}. Mark it done?`,
    consequence: 'Yes closes the promise.',
    yes: 'Yes, mark done',
    no: 'Not yet',
  };
}

/** A status the existing inference points at: "No reply in 31 days. Mark QA Enter Key Client as Cold?" */
export function statusCopy(reason: string, clientName: string, status: 'cold' | 'done'): CardCopy {
  const lead = reason.trim().replace(/[.!?]+$/, '');
  return status === 'cold'
    ? { question: `${lead}. Mark ${clientName} as Cold?`, consequence: 'Yes sets their status to Cold.', yes: 'Mark cold', no: 'Keep warm' }
    : { question: `${lead}. Mark ${clientName} as Done (lost)?`, consequence: 'Yes sets their status to Done.', yes: 'Mark lost', no: 'Keep open' };
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2026-10-10…" → "Sat 10 Oct" (read positionally: the date as said, no timezone drift). */
export function shortDay(iso: string | null | undefined): string | null {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return `${DAYS[d.getUTCDay()]} ${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}`;
}

const VERB = /^(send|share|get|give|bring|forward|email|pay|book|arrange|prepare|deliver|confirm|call|check)\s+(.+)$/i;
/** [P40-1] A promise whose date the resolver couldn't read: "When is the floor plans promise due?" and what was said,
 *  "You said 'Sunday morning' on Sat 10 Oct." (the client's name for a client's promise). */
export function dateCopy(p: { text: string; owner: string; clientName?: string | null; dueRaw: string | null; sourceMessageAt?: string | null; receipt?: { at: string | null } }): { question: string; said: string } {
  const t = p.text.trim().replace(/[.!]+$/, '');
  const m = VERB.exec(t);
  const object = m ? m[2]! : null;
  const question = object && /^(the|a|an|her|his|their|your|my)\b/i.test(object) && !/^call$/i.test(m![1]!)
    ? `When is the ${object.replace(/^(the|a|an)\s+/i, '')} promise due?`
    : `When is '${t}' due?`;
  const who = p.owner === 'client' && p.clientName ? p.clientName : 'You';
  const when = shortDay(p.sourceMessageAt ?? p.receipt?.at ?? null);
  return { question, said: `${who} said '${(p.dueRaw ?? '').trim()}'${when ? ` on ${when}` : ''}.` };
}

/** "2026-10-10T15:00" → "Sat 10 Oct, 15:00" (the wall clock as given). */
export function shortDayTime(iso: string | null | undefined): string | null {
  const day = shortDay(iso);
  const t = iso ? /T(\d{2}:\d{2})/.exec(iso)?.[1] : null;
  return day && t ? `${day}, ${t}` : day;
}

/** [P40-1 · owner] A meeting the resolver couldn't time: "When is the meeting with Sara Khan?" and what was said,
 *  when. The record doesn't keep who said it, so the line names the chat, not "you". */
export function meetingDateCopy(m: { clientName?: string | null; title: string | null; datetimeRaw: string; sourceMessageAt?: string | null; captureAt?: string | null; day?: string | null }): { question: string; said: string } {
  const what = m.title?.trim() || 'meeting';
  const who = m.clientName ? ` with ${m.clientName}` : '';
  const when = shortDay(m.sourceMessageAt ?? m.captureAt ?? null);
  // [P43-7 · owner] the day is known ("Saturday"): ask only for the time
  const onDay = shortDay(m.day ?? null);
  return { question: onDay ? `What time is the ${what}${who} on ${onDay}?` : `When is the ${what}${who}?`, said: `The chat said '${m.datetimeRaw.trim()}'${when ? ` on ${when}` : ''}.` };
}

/** [P50-2] "Is 'Khalid' in this chat the same person as Khalid Al Mansoori?" (the question comes from the server). */
export function samePersonCopy(clientName: string): Omit<CardCopy, 'question'> {
  return {
    consequence: `Same person: Tovira files them under ${clientName}. Different person: they stay separate, and Tovira won't ask again.`,
    yes: 'Same person',
    no: 'Different person',
  };
}
