/** Client for meetings — list, natural-language parse, create, delete (P3-1). */

export interface Meeting {
  id: string;
  clientId: string;
  datetime: string | null;
  datetimeRaw: string;
  title: string | null;
  confirmed?: boolean;
  createdAt: number;
}

/** The parser's discriminated result (mirrors the server) — the UI branches on
 *  `kind` so an ambiguous name/time ASKS instead of silently picking (P3-1). */
export type ParseResult =
  | { kind: 'proposal'; clientId: string; clientName: string; datetime: string | null; datetimeRaw: string }
  | { kind: 'ambiguous_time'; datetimeRaw: string }
  | { kind: 'ambiguous_client'; candidates: Array<{ id: string; name: string }>; datetime: string; datetimeRaw: string }
  | { kind: 'no_client'; name: string };

export class MeetingsClient {
  constructor(private readonly baseUrl: string = '') {}

  async list(): Promise<Meeting[]> {
    try {
      const res = await fetch(`${this.baseUrl}/meetings`, { credentials: 'include' });
      if (res.status !== 200) return [];
      return ((await res.json()) as { meetings: Meeting[] }).meetings;
    } catch {
      return [];
    }
  }

  /** Parse "meeting with X Tue 3pm" into the parser's discriminated result — the
   *  UI decides whether to preview, ask which client, or ask for a time. null on
   *  a transport failure only. */
  async parse(text: string): Promise<ParseResult | null> {
    try {
      const res = await fetch(`${this.baseUrl}/meetings/parse`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (res.status !== 200) return null;
      return (await res.json()) as ParseResult;
    } catch {
      return null;
    }
  }

  async createForClient(clientId: string, meeting: { datetime: string | null; datetimeRaw: string; title: string | null }): Promise<Meeting | null> {
    try {
      const res = await fetch(`${this.baseUrl}/clients/${clientId}/meetings`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(meeting),
      });
      if (res.status !== 201) return null;
      return (await res.json()) as Meeting;
    } catch {
      return null;
    }
  }

  async remove(id: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/meetings/${id}`, { method: 'DELETE', credentials: 'include' });
      return res.status === 200;
    } catch {
      return false;
    }
  }

  /** Confirm a proposed (extraction-suggested) meeting → confirmed, nudge-eligible. */
  async confirm(id: string): Promise<Meeting | null> {
    try {
      const res = await fetch(`${this.baseUrl}/meetings/${id}/confirm`, { method: 'POST', credentials: 'include' });
      if (res.status !== 200) return null;
      return (await res.json()) as Meeting;
    } catch {
      return null;
    }
  }
}
