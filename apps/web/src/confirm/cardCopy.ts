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

/** A held statement that sets a known field: "Did Sara Khan's budget change to AED 2.2M?" */
export function fieldCopy(clientName: string, field: string, value: string): CardCopy {
  const said = field === 'budget' || field === 'price' ? withAed(value) : value;
  return {
    question: `Did ${clientName}'s ${field} change to ${said}?`,
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
