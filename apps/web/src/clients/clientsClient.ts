import { LOCKED, type Locked } from '../billing/gated.js';
import type { Pointer } from './PointersCard.js';

export interface ClientSummary {
  id: string;
  name: string;
  phone: string | null;
  title?: string | null;
  email?: string | null;
  createdAt: number;
}

export type ExtractionState = 'queued' | 'processing' | 'done' | 'failed';

/** [ASYNC-EXTRACT] The rep-facing state of a note: prefer the server's value, else derive from status
 *  (so it's correct against an older response). Mirrors the server's extractionState. */
export function extractionStateOf(n: { status: string; extractionState?: ExtractionState }): ExtractionState {
  if (n.extractionState) return n.extractionState;
  if (n.status === 'extracted') return 'done';
  if (n.status === 'needs_review' || n.status === 'import_failed' || n.status === 'transcription_failed') return 'failed';
  if (n.status === 'pending_transcription' || n.status === 'pending_extraction') return 'processing';
  return 'queued';
}

/** True while any note is still queued or processing — the signal to keep polling for updates. */
export function anyExtractionInProgress(notes: Array<{ status: string; extractionState?: ExtractionState }>): boolean {
  return notes.some((n) => {
    const s = extractionStateOf(n);
    return s === 'queued' || s === 'processing';
  });
}

export interface NoteSummary {
  id: string;
  source: 'voice' | 'paste';
  rawText: string | null;
  status: string;
  createdAt: number;
  /** [ASYNC-EXTRACT] the rep-facing state the server computes; absent on older responses. */
  extractionState?: ExtractionState;
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
  /** [POINTERS · D9] the client's current relationship/closing pointers + the retrospective disclosure. */
  pointers?: Pointer[];
  pointersDisclosure?: string | null;
}

export interface Stakeholder {
  name: string | null;
  role: string | null;
  reports_to: string | null;
  decision_role: string;
  notes: string | null;
}

export type ImportResult =
  | { ok: true; imported: number; ceilingReached?: boolean; duplicate?: boolean; pending?: boolean; truncated?: boolean }
  | { ok: false; error: 'misfile'; message: string; counterparts: string[]; suggestion: { id: string; name: string } | null }
  | { ok: false; error: 'ack_required'; message: string }
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

  async create(name: string, phone?: string, extras?: { title?: string | null; email?: string | null }): Promise<ClientSummary> {
    const body: Record<string, unknown> = { name };
    if (phone) body.phone = phone;
    if (extras?.title) body.title = extras.title;
    if (extras?.email) body.email = extras.email;
    const res = await fetch(this.url('/clients'), {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      throw new Error(body.message ?? 'Could not create client.');
    }
    return (await res.json()) as ClientSummary;
  }

  /** [OUTCOME-3] Set a client's deal outcome (rep-sourced server-side). 'lost' → lost_confirmed;
   *  'open' also resets the going-quiet clock. Returns whether it persisted. */
  async setOutcome(id: string, outcome: 'won' | 'lost' | 'open'): Promise<boolean> {
    try {
      const res = await fetch(this.url(`/clients/${encodeURIComponent(id)}/outcome`), {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ outcome }),
      });
      return res.ok;
    } catch {
      return false;
    }
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

  /** Import a WhatsApp chat export under a client (P1-4b / IMPORT-ZIP). Accepts either pasted text
   *  (a string, or `{ content }`) or a file's raw bytes (`{ contentBase64 }` — for the .zip iOS
   *  exports, or a .txt read as bytes). The server detects zip vs text by content, not filename. */
  async importWhatsApp(clientId: string, input: string | { content?: string; contentBase64?: string; misfileAck?: boolean; confirmImport?: boolean; counterpart?: string; firstImportAck?: boolean }, consent: boolean): Promise<ImportResult> {
    const payload = typeof input === 'string' ? { content: input } : input;
    // [FIX 1] Chat uploads go as RAW BINARY (no base64/JSON inflation, no 1 MB JSON cap) — the file bytes
    // are the body and the small metadata rides in the query string, so a long-history export fits.
    const bytes = typeof payload.contentBase64 === 'string' && payload.contentBase64.length > 0
      ? Uint8Array.from(atob(payload.contentBase64), (c) => c.charCodeAt(0))
      : new TextEncoder().encode(payload.content ?? '');
    // [FOLLOW-UP 1] metadata in X-Tovira-* headers (never the URL — a counterpart name is personal data).
    const headers: Record<string, string> = { 'content-type': 'application/octet-stream' };
    if (consent) headers['X-Tovira-Consent'] = '1';
    if (payload.misfileAck) headers['X-Tovira-Misfile-Ack'] = '1';
    if (payload.confirmImport) headers['X-Tovira-Confirm-Import'] = '1';
    if (payload.firstImportAck) headers['X-Tovira-First-Import-Ack'] = '1';
    if (payload.counterpart) headers['X-Tovira-Counterpart'] = encodeURIComponent(payload.counterpart);
    let res: Response;
    try {
      res = await fetch(this.url(`/clients/${clientId}/notes/import`), {
        method: 'POST',
        credentials: 'include',
        headers,
        body: bytes,
      });
    } catch {
      return { ok: false, error: 'other', message: 'Network error — please try again.' };
    }
    // 202 = accepted, messages stored, extraction running in the background
    // (IMPORT-ASYNC — the upload no longer blocks on a slow model); 201 = stored
    // (legacy synchronous); 200 = idempotent no-op (a fully-overlapping re-import).
    // ALL are successes — the refresh loop must never read a correct dedupe as a
    // failure. The Book Scan populates as the sweep drains the pending note.
    if (res.status === 202 || res.status === 201 || res.status === 200) {
      const body = (await res.json().catch(() => ({}))) as { imported?: number; ceilingReached?: boolean; duplicate?: boolean; status?: string; truncated?: boolean };
      const imported = body.imported ?? 0;
      const trunc = body.truncated ? { truncated: true as const } : {};
      if (body.duplicate) return { ok: true, imported, duplicate: true, ...trunc };
      // Only attach a flag when it applies — keeps the common { ok, imported } shape clean.
      if (body.ceilingReached) return { ok: true, imported, ceilingReached: true, ...trunc };
      return body.status === 'pending_extraction' ? { ok: true, imported, pending: true, ...trunc } : { ok: true, imported, ...trunc };
    }
    if (res.status === 409) {
      // MISFILE-DETECT: the transcript's counterpart does not look like this client. Surface the
      // suggestion; the rep confirms (re-submit with misfileAck) or files elsewhere. Never blocked.
      const body = (await res.json().catch(() => ({}))) as { message?: string; counterparts?: string[]; suggestion?: { id: string; name: string } | null };
      return { ok: false, error: 'misfile', message: body.message ?? 'This chat may be filed under the wrong client.', counterparts: body.counterparts ?? [], suggestion: body.suggestion ?? null };
    }
    if (res.status === 400) return { ok: false, error: 'consent', message: 'Please confirm consent to import.' };
    if (res.status === 413) return { ok: false, error: 'too_large', message: 'That export is too large to import.' };
    if (res.status === 422) {
      const body = (await res.json().catch(() => ({}))) as { reason?: string };
      return { ok: false, error: 'not_whatsapp', message: body.reason ?? "That doesn't look like a WhatsApp export." };
    }
    if (res.status === 404) return { ok: false, error: 'not_found', message: 'Client not found.' };
    if (res.status === 428) {
      // [AUDIT gap A] First-ever import: the server asks the rep to acknowledge they have the right to
      // upload the whole conversation. Its body carries `notice` (not `message`), so without this branch
      // it fell through to the generic "Import failed." Re-import with firstImportAck to proceed.
      const body = (await res.json().catch(() => ({}))) as { notice?: string };
      return { ok: false, error: 'ack_required', message: body.notice ?? 'Before your first import, please confirm you have the right to upload this conversation.' };
    }
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

  async getBrief(clientId: string): Promise<Brief | Locked | null> {
    const res = await fetch(this.url(`/clients/${clientId}/brief`), { credentials: 'include' });
    if (res.status === 402) return LOCKED; // trial lapsed → the embedded surface shows <Locked>
    if (res.status !== 200) return null;
    return (await res.json()) as Brief;
  }

  /** [POINTERS · D8] the client's current pointer set, for the thread card. */
  async getPointers(clientId: string): Promise<{ pointers: Pointer[]; disclosure: string | null }> {
    try {
      const res = await fetch(this.url(`/clients/${clientId}/pointers`), { credentials: 'include' });
      if (res.status !== 200) return { pointers: [], disclosure: null };
      const body = (await res.json()) as { pointers?: Pointer[]; disclosure?: string | null };
      return { pointers: body.pointers ?? [], disclosure: body.disclosure ?? null };
    } catch {
      return { pointers: [], disclosure: null };
    }
  }

  /** Draft an editable follow-up message from a note (P4-4). Never sends. */
  async draftFollowUp(noteId: string): Promise<string | Locked | null> {
    try {
      const res = await fetch(this.url(`/notes/${noteId}/follow-up`), { method: 'POST', credentials: 'include' });
      if (res.status === 402) return LOCKED;
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
