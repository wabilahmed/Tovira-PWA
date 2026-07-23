export interface ClientSummary {
  id: string;
  name: string;
  createdAt: number;
}

export interface NoteSummary {
  id: string;
  source: 'voice' | 'paste';
  rawText: string | null;
  status: string;
  createdAt: number;
}

export interface Brief {
  clientName: string;
  empty: boolean;
  openPromises: Array<{ id: string; text: string; dueDate: string | null; dueRaw: string | null }>;
  needsConfirmation: Array<{ id: string; text: string }>;
  keyPeople: Array<{ name: string | null; role: string | null; decision_role: string }>;
  personalNotes: Array<{ subject: string; fact: string }>;
  concerns: string[];
  relatedNotes: Array<{ noteId: string; snippet: string }>;
}

export interface Stakeholder {
  name: string | null;
  role: string | null;
  reports_to: string | null;
  decision_role: string;
  notes: string | null;
}

export type ImportResult =
  | { ok: true; imported: number }
  | { ok: false; error: 'consent' | 'not_whatsapp' | 'too_large' | 'not_found' | 'other'; message: string };

/** Client-side API for the rep's clients (same-origin; session cookie included). */
export class ClientsClient {
  constructor(private readonly baseUrl: string = '') {}

  private url(path: string): string {
    return `${this.baseUrl}${path}`;
  }

  async list(query?: string): Promise<ClientSummary[]> {
    const path = query ? `/clients?q=${encodeURIComponent(query)}` : '/clients';
    try {
      const res = await fetch(this.url(path), { credentials: 'include' });
      if (res.status !== 200) return [];
      const data = (await res.json()) as { clients: ClientSummary[] };
      return data.clients;
    } catch {
      return [];
    }
  }

  async create(name: string): Promise<ClientSummary> {
    const res = await fetch(this.url('/clients'), {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      throw new Error(body.message ?? 'Could not create client.');
    }
    return (await res.json()) as ClientSummary;
  }

  async get(id: string): Promise<ClientSummary | null> {
    const res = await fetch(this.url(`/clients/${id}`), { credentials: 'include' });
    if (res.status !== 200) return null;
    return (await res.json()) as ClientSummary;
  }

  async createPasteNote(clientId: string, text: string): Promise<NoteSummary> {
    const res = await fetch(this.url(`/clients/${clientId}/notes/paste`), {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      throw new Error(body.message ?? 'Could not save the message.');
    }
    return (await res.json()) as NoteSummary;
  }

  /** Import a WhatsApp chat export (.txt content) under a client (P1-4b). */
  async importWhatsApp(clientId: string, content: string, consent: boolean): Promise<ImportResult> {
    let res: Response;
    try {
      res = await fetch(this.url(`/clients/${clientId}/notes/import`), {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content, consent }),
      });
    } catch {
      return { ok: false, error: 'other', message: 'Network error — please try again.' };
    }
    if (res.status === 201) {
      const body = (await res.json()) as { imported: number };
      return { ok: true, imported: body.imported };
    }
    if (res.status === 400) return { ok: false, error: 'consent', message: 'Please confirm consent to import.' };
    if (res.status === 413) return { ok: false, error: 'too_large', message: 'That export is too large to import.' };
    if (res.status === 422) {
      const body = (await res.json().catch(() => ({}))) as { reason?: string };
      return { ok: false, error: 'not_whatsapp', message: body.reason ?? "That doesn't look like a WhatsApp export." };
    }
    if (res.status === 404) return { ok: false, error: 'not_found', message: 'Client not found.' };
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    return { ok: false, error: 'other', message: body.message ?? 'Import failed.' };
  }

  async listNotes(clientId: string): Promise<NoteSummary[]> {
    try {
      const res = await fetch(this.url(`/clients/${clientId}/notes`), { credentials: 'include' });
      if (res.status !== 200) return [];
      return ((await res.json()) as { notes: NoteSummary[] }).notes;
    } catch {
      return [];
    }
  }

  async transcribeNote(noteId: string): Promise<void> {
    await fetch(this.url(`/notes/${noteId}/transcribe`), { method: 'POST', credentials: 'include' });
  }

  async extractNote(noteId: string): Promise<void> {
    await fetch(this.url(`/notes/${noteId}/extract`), { method: 'POST', credentials: 'include' });
  }

  async getBrief(clientId: string): Promise<Brief | null> {
    const res = await fetch(this.url(`/clients/${clientId}/brief`), { credentials: 'include' });
    if (res.status !== 200) return null;
    return (await res.json()) as Brief;
  }

  /** Draft an editable follow-up message from a note (P4-4). Never sends. */
  async draftFollowUp(noteId: string): Promise<string | null> {
    try {
      const res = await fetch(this.url(`/notes/${noteId}/follow-up`), { method: 'POST', credentials: 'include' });
      if (res.status !== 200) return null;
      return ((await res.json()) as { draft: string }).draft;
    } catch {
      return null;
    }
  }

  /** The stakeholder map for a client — who's who in the deal (P4-2). */
  async getStakeholders(clientId: string): Promise<Stakeholder[]> {
    try {
      const res = await fetch(this.url(`/clients/${clientId}/stakeholders`), { credentials: 'include' });
      if (res.status !== 200) return [];
      return ((await res.json()) as { people: Stakeholder[] }).people;
    } catch {
      return [];
    }
  }

  async confirmPromise(id: string): Promise<void> {
    await fetch(this.url(`/promises/${id}/confirm`), { method: 'POST', credentials: 'include' });
  }

  async rejectPromise(id: string): Promise<void> {
    await fetch(this.url(`/promises/${id}`), { method: 'DELETE', credentials: 'include' });
  }
}
