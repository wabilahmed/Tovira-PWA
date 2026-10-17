import type { ModelClient } from '../../ports/model.js';
import type { ClientRepository } from '../../ports/client-repository.js';
import { resolveDueDate } from '../extraction/resolve-date.js';
import { nameMentionedIn } from '../text/normalize-name.js';

/**
 * Parse a natural-language scheduling request ("meeting with Sarah next Tuesday
 * 3pm") into a proposed meeting the rep confirms before it's saved (P3-1).
 *
 * Never invents: a vague time asks for specifics; an ambiguous client name asks
 * which one. Parsing NEVER writes to the calendar — only an explicit confirm does.
 */
export type ParseResult =
  | { kind: 'proposal'; clientId: string; clientName: string; datetime: string | null; datetimeRaw: string }
  | { kind: 'ambiguous_time'; datetimeRaw: string }
  | { kind: 'ambiguous_client'; candidates: Array<{ id: string; name: string }>; datetime: string; datetimeRaw: string }
  | { kind: 'no_client'; name: string };

const SYSTEM = `You turn a short scheduling request into JSON. Extract the client name and the meeting time. Resolve relative times ("next Tuesday 3pm") against TODAY into an ISO datetime "YYYY-MM-DDTHH:MM"; if the time is vague or missing (e.g. "sometime next week"), set datetime to null but keep the phrase. Output ONLY:
{"clientName":"...","datetime":"YYYY-MM-DDTHH:MM|null","datetimeRaw":"original phrase"}`;

interface Parsed {
  clientName: string;
  datetime: string | null;
  datetimeRaw: string;
}

/** [P16-1] Pull the date phrase out of free text so the P14-3 resolver (which expects a date phrase, not
 *  a whole sentence) can resolve it. Recognises today/tomorrow, a weekday (optionally this/next),
 *  "in N days|weeks", "end of month", and an explicit numeric/ISO date. Returns null when none is present;
 *  the resolver still decides what is actually resolvable (e.g. "next Thursday" → null). */
function extractDatePhrase(text: string): string | null {
  const re = /\b((?:this|next)\s+)?(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\bin\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:days?|weeks?)\b|\bend\s+of\s+(?:the\s+)?month\b|\b\d{1,2}[./-]\d{1,2}[./-]\d{4}\b|\b\d{4}-\d{2}-\d{2}\b/i;
  const m = re.exec(text);
  return m ? m[0] : null;
}

/** [P16-1] Extract an EXPLICIT clock time ("3pm", "3:30pm", "15:00", "9 am") as "HH:MM". Returns null for
 *  anything ambiguous ("around four", "afternoon") — resolving those would be a guess, and a wrong time is
 *  worse than letting the rep pick it. Deterministic, no model. */
function extractClockTime(text: string): string | null {
  const ampm = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i.exec(text);
  if (ampm) {
    let h = Number(ampm[1]);
    const m = ampm[2] ? Number(ampm[2]) : 0;
    const pm = ampm[3]!.toLowerCase() === 'pm';
    if (h < 1 || h > 12 || m > 59) return null;
    if (h === 12) h = pm ? 12 : 0;
    else if (pm) h += 12;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  const h24 = /\b([01]?\d|2[0-3]):([0-5]\d)\b/.exec(text);
  if (h24) return `${h24[1]!.padStart(2, '0')}:${h24[2]}`;
  return null;
}

export class MeetingParser {
  constructor(
    private readonly model: ModelClient,
    private readonly clients: ClientRepository,
  ) {}

  /**
   * [P16-1] Deterministic parse — NO model call. Used when the rep isn't entitled: logging a meeting is
   * capture and capture is never blocked, so instead of a 402 we resolve what we can locally (the P14-3
   * date resolver + an explicit clock time + a client-name match) and leave the rest to the rep's normal
   * date/time picker. It never invents a client (ambiguous → the picker/candidate list) and never a time.
   */
  async parseDeterministic(userId: string, text: string, today: string): Promise<ParseResult> {
    const phrase = extractDatePhrase(text);                  // pull the date words out of the free text
    const date = phrase ? resolveDueDate(phrase, today).date : null; // "YYYY-MM-DD" | null (P14-3; never guesses)
    const time = extractClockTime(text);                     // "HH:MM" | null (explicit am/pm or 24h only)
    const datetime = date && time ? `${date}T${time}` : null;
    const datetimeRaw = text.trim();

    const clients = await this.clients.listByUser(userId);
    const matches = clients.filter((c) => nameMentionedIn(c.name, text));
    // A proposal needs BOTH a single client AND a resolved time — same contract as the model path, so the
    // web client handles it identically. Anything short of that routes to the picker / a client choice;
    // the rep is never blocked and we never invent the missing piece.
    if (matches.length === 1 && datetime) {
      return { kind: 'proposal', clientId: matches[0]!.id, clientName: matches[0]!.name, datetime, datetimeRaw };
    }
    if (matches.length > 1 && datetime) {
      return { kind: 'ambiguous_client', candidates: matches.map((c) => ({ id: c.id, name: c.name })), datetime, datetimeRaw };
    }
    return { kind: 'ambiguous_time', datetimeRaw };
  }

  async parse(userId: string, text: string, today: string): Promise<ParseResult> {
    const parsed = await this.callModel(text, today, userId);
    if (!parsed || !parsed.clientName) return { kind: 'ambiguous_time', datetimeRaw: text };

    // Vague/missing time → ask for specifics rather than inventing one.
    if (!parsed.datetime) return { kind: 'ambiguous_time', datetimeRaw: parsed.datetimeRaw || text };

    const matches = await this.clients.search(userId, parsed.clientName);
    if (matches.length === 0) return { kind: 'no_client', name: parsed.clientName };
    if (matches.length > 1) {
      return {
        kind: 'ambiguous_client',
        candidates: matches.map((c) => ({ id: c.id, name: c.name })),
        datetime: parsed.datetime,
        datetimeRaw: parsed.datetimeRaw,
      };
    }
    return {
      kind: 'proposal',
      clientId: matches[0]!.id,
      clientName: matches[0]!.name,
      datetime: parsed.datetime,
      datetimeRaw: parsed.datetimeRaw,
    };
  }

  private async callModel(text: string, today: string, userId: string): Promise<Parsed | null> {
    let raw: string;
    try {
      const res = await this.model.complete({
        system: SYSTEM,
        messages: [{ role: 'user', content: `TODAY: ${today}\nREQUEST: ${text}` }],
        // [EXTRACT-MAXTOKENS] This parser runs on Sonnet (the default 'extraction' model class), a
        // reasoning model — 256 was below the reasoning budget (~415 thinking on a tiny input), so it
        // was latently truncating like extraction. 4096 clears thinking + the small datetime JSON.
        maxTokens: 4096,
        userId,
        spendClass: 'meeting', // SPEND-CAP
      });
      raw = res.text;
    } catch {
      return null;
    }
    try {
      const obj = JSON.parse(raw) as Partial<Parsed>;
      if (typeof obj.clientName !== 'string') return null;
      return {
        clientName: obj.clientName,
        datetime: typeof obj.datetime === 'string' ? obj.datetime : null,
        datetimeRaw: typeof obj.datetimeRaw === 'string' ? obj.datetimeRaw : text,
      };
    } catch {
      return null;
    }
  }
}
