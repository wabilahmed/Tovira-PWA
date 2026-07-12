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

  async listNotes(clientId: string): Promise<NoteSummary[]> {
    try {
      const res = await fetch(this.url(`/clients/${clientId}/notes`), { credentials: 'include' });
      if (res.status !== 200) return [];
      return ((await res.json()) as { notes: NoteSummary[] }).notes;
    } catch {
      return [];
    }
  }
}
