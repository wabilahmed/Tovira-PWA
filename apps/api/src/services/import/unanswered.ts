/**
 * Unanswered client-question detection over an imported chat export (P1-6).
 *
 * Chat exports carry who-said-what, so "a client question the rep never answered"
 * is a STRUCTURAL property of the message sequence — no model needed, and no risk
 * of a hallucinated accusation. We only ever flag when we can confidently tell
 * which speaker is the client; otherwise we stay silent (a wrong fact is worse
 * than a missing one — and a false "you ignored them" is the worst kind).
 */
import type { ImportedMessage } from '../../ports/note-repository.js';

export interface UnansweredQuestion {
  question: string;
  sentAt: string | null;
  sender: string;
}

function firstToken(name: string): string {
  return name.trim().toLowerCase().split(/\s+/)[0] ?? '';
}

/** Does this speaker name plausibly refer to the Tovira client? */
function matchesClient(sender: string, clientName: string): boolean {
  const s = sender.trim().toLowerCase();
  const c = clientName.trim().toLowerCase();
  if (s === '' || c === '') return false;
  if (s === c || s.includes(c) || c.includes(s)) return true;
  return firstToken(sender) === firstToken(clientName);
}

const squashName = (name: string): string => name.trim().toLowerCase().replace(/\s+/g, ' ');

export interface SpeakerIdentity {
  /** [P28] The client's learned aliases (exact sender names the rep confirmed, e.g. "Bubu DXB"). */
  aliases?: readonly string[];
  /** [P28] The rep's own WhatsApp name, when known. */
  repName?: string | null;
}

/**
 * Tag each message's role. The client speaker is the one whose sender matches the client's name or — [P28] —
 * one of its confirmed aliases (exact, ignoring case and spacing); every other speaker is the rep. If the
 * client is not identified that way but the rep's own name is known and the chat has exactly TWO speakers,
 * one of them the rep, the other is the client (by elimination — the same rule the import uses to identify
 * the counterpart). Otherwise every role stays 'unknown' (we won't guess and risk a false accusation).
 */
export function assignSpeakerRoles(messages: ImportedMessage[], clientName: string, who: SpeakerIdentity = {}): ImportedMessage[] {
  const aliases = new Set((who.aliases ?? []).map(squashName).filter(Boolean));
  const isClient = (sender: string): boolean => matchesClient(sender, clientName) || aliases.has(squashName(sender));
  if (messages.some((m) => isClient(m.sender))) {
    return messages.map((m) => ({ ...m, role: isClient(m.sender) ? 'client' : 'rep' }));
  }
  const rep = who.repName ? squashName(who.repName) : '';
  const speakers = [...new Set(messages.map((m) => squashName(m.sender)).filter(Boolean))];
  if (rep && speakers.length === 2 && speakers.includes(rep)) {
    return messages.map((m) => ({ ...m, role: squashName(m.sender) === rep ? 'rep' : 'client' }));
  }
  return messages.map((m) => ({ ...m, role: 'unknown' }));
}

/**
 * A client message is an unanswered question when it contains a '?' and NO rep
 * message appears anywhere after it (the thread went dead on them). Requiring a
 * later rep message anywhere — not just an immediate reply — means a rep who
 * answered a batch of questions in one reply is never falsely flagged.
 */
export function detectUnansweredQuestions(messages: ImportedMessage[]): UnansweredQuestion[] {
  const out: UnansweredQuestion[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!;
    if (m.role !== 'client' || m.media || !m.body.includes('?')) continue;
    const repRepliedAfter = messages.slice(i + 1).some((later) => later.role === 'rep');
    if (!repRepliedAfter) {
      out.push({ question: m.body.trim(), sentAt: m.sentAt, sender: m.sender });
    }
  }
  return out;
}
