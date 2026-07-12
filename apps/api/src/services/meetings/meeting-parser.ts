import type { ModelClient } from '../../ports/model.js';
import type { ClientRepository } from '../../ports/client-repository.js';

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

export class MeetingParser {
  constructor(
    private readonly model: ModelClient,
    private readonly clients: ClientRepository,
  ) {}

  async parse(userId: string, text: string, today: string): Promise<ParseResult> {
    const parsed = await this.callModel(text, today);
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

  private async callModel(text: string, today: string): Promise<Parsed | null> {
    let raw: string;
    try {
      const res = await this.model.complete({
        system: SYSTEM,
        messages: [{ role: 'user', content: `TODAY: ${today}\nREQUEST: ${text}` }],
        maxTokens: 256,
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
