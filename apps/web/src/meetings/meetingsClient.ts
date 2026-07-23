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

export interface ParsedMeeting {
  clientId: string | null;
  clientName?: string | null;
  datetime: string | null;
  datetimeRaw: string;
  title: string | null;
}

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

  /** Parse "meeting with X Tue 3pm" for a confirm-before-save preview. */
  async parse(text: string): Promise<ParsedMeeting | null> {
    try {
      const res = await fetch(`${this.baseUrl}/meetings/parse`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (res.status !== 200) return null;
      return (await res.json()) as ParsedMeeting;
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
}
