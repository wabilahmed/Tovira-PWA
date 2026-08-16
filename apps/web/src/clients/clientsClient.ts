export interface ClientSummary {
  id: string;
  name: string;
  phone: string | null;
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
  | { ok: true; imported: number; ceilingReached?: boolean; duplicate?: boolean }
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

  async create(name: string, phone?: string): Promise<ClientSummary> {
    const res = await fetch(this.url('/clients'), {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      // Send phone only when present — keeps the common create body { name }.
      body: JSON.stringify(phone ? { name, phone } : { name }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      throw new Error(body.message ?? 'Could not create client.');
    }
    return (await res.json()) as ClientSummary;
  }

  /** Set (or clear) a client's phone (P4-7). Returns the updated record, or null
   *  on failure (e.g. not the owner). */
  async setPhone(id: string, phone: string | null): Promise<ClientSummary | null> {
    try {
      const res = await fetch(this.url(`/clients/${id}`), {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phone }),
      });
      if (!res.ok) return null;
      return (await res.json()) as ClientSummary;
    } catch {
      return null;
    }
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
    // 201 = new content stored; 200 = idempotent no-op (a fully-overlapping
    // re-import). BOTH are successes — the refresh loop must never read a correct
    // dedupe as a failure.
    if (res.status === 201 || res.status === 200) {
      const body = (await res.json().catch(() => ({}))) as { imported?: number; ceilingReached?: boolean; duplicate?: boolean };
      const imported = body.imported ?? 0;
      if (body.duplicate) return { ok: true, imported, duplicate: true };
      // Only attach the flag when the ceiling was actually hit — keeps the common
      // success shape { ok, imported } clean.
      return body.ceilingReached ? { ok: true, imported, ceilingReached: true } : { ok: true, imported };
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

  /** Every note still awaiting transcription/extraction across all clients — the
   *  resume path so a voice note never stalls if its client screen isn't reopened. */
  async listPendingNotes(): Promise<NoteSummary[]> {
    try {
      const res = await fetch(this.url('/notes/pending'), { credentials: 'include' });
      if (res.status !== 200) return [];
      return ((await res.json()) as { notes: NoteSummary[] }).notes;
    } catch {
      return [];
    }
  }

  async transcribeNote(noteId: string): Promise<void> {
    await fetch(this.url(`/notes/${noteId}/transcribe`), { method: 'POST', credentials: 'include' });
  }

  /** Kick extraction for a note. Returns the server-reported status so the caller
   *  can react to a ceiling stop (`trial_limit`) without any client-side math. */
  async extractNote(noteId: string): Promise<{ status?: string }> {
    try {
      const res = await fetch(this.url(`/notes/${noteId}/extract`), { method: 'POST', credentials: 'include' });
      if (res.status !== 200) return {};
      const body = (await res.json()) as { status?: string };
      return { status: body.status };
    } catch {
      return {};
    }
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
