import { LOCKED, type Locked } from '../billing/gated.js';
import type { Pointer } from './PointersCard.js';

/** [LEAD-STATUS] The rep's manual pipeline label; null = Unsorted (the default). Only a rep changes it. */
export type LeadStatus = 'warm' | 'cold' | 'done';

export interface ClientSummary {
  id: string;
  name: string;
  phone: string | null;
  title?: string | null;
  email?: string | null;
  createdAt: number;
  /** [LEAD-STATUS] null = Unsorted. Absent on older responses → treat as Unsorted. */
  leadStatus?: LeadStatus | null;
  leadStatusChangedAt?: number | null;
  /** [OUTCOME] the deal outcome (open / won / lost_confirmed / lost_inferred); absent on older responses. */
  outcome?: string;
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
  /** [IMP-17] set on a PENDING note when billing stops it from being read right now, so the book can say
   *  so (not spin on "queued…" forever). Clears itself once billing is fixed. */
  blockedReason?: 'subscribe' | 'payment' | 'allowance';
  /** [TASK 2 / erasure] set while a note about a restricted counterparty is held during a privacy
   *  review — its content is withheld server-side; the book shows `restrictionNotice` instead. */
  restricted?: boolean;
  restrictionNotice?: string;
}

/** [P18-10b] A fact's receipt as the server sends it (withReceipt): the verbatim quote + its date. */
export interface FactReceipt {
  quote: string | null;
  source: 'message' | 'capture' | 'none';
  at: string | null;
  label: string;
}

export interface Brief {
  clientName: string;
  empty: boolean;
  openPromises: Array<{ id: string; text: string; dueDate: string | null; dueRaw: string | null; receipt?: FactReceipt }>;
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
  | { ok: false; error: 'misfile'; message: string; counterparts: string[]; suggestion: { id: string; name: string } | null; needsRepIdentification?: boolean; participants?: string[]; group?: boolean; counterpart?: string | null; clientName?: string; messageCount?: number; dateFrom?: string | null; dateTo?: string | null }
  | { ok: false; error: 'ack_required'; message: string }
  | { ok: false; error: 'allowance' | 'payment'; message: string }
  | { ok: false; error: 'consent' | 'not_whatsapp' | 'too_large' | 'not_found' | 'other'; message: string };

/** Client-side API for the rep's clients (same-origin; session cookie included). */
export class ClientsClient {
  constructor(private readonly baseUrl: string = '') {}

  private url(path: string): string {
    return `${this.baseUrl}${path}`;
  }

  /** The rep's full client list (name + phone + email), recents-first. Search is done client-side in
   *  the PWA, so the query is NEVER sent to the server — it can't leak into a request URL. */
  async list(): Promise<ClientSummary[]> {
    try {
      const res = await fetch(this.url('/clients'), { credentials: 'include' });
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

  /** [P36-7] What the existing inference would change, as suggestions only (To Confirm + the status sheet). */
  async statusSuggestions(): Promise<Array<{ clientId: string; clientName: string; status: 'cold' | 'done'; outcome?: 'lost'; reason: string }>> {
    try {
      const res = await fetch(this.url('/clients/status-suggestions'), { credentials: 'include' });
      if (res.status !== 200) return [];
      const body = (await res.json()) as { suggestions?: unknown };
      return Array.isArray(body.suggestions) ? (body.suggestions as Awaited<ReturnType<ClientsClient['statusSuggestions']>>) : [];
    } catch {
      return [];
    }
  }

  /** [LEAD-STATUS] Set (or clear → null = Unsorted) a client's MANUAL pipeline label. Returns the
   *  updated record, or null on failure (e.g. not the owner) so the caller can roll back optimistic UI. */
  async setLeadStatus(id: string, status: LeadStatus | null): Promise<ClientSummary | null> {
    try {
      const res = await fetch(this.url(`/clients/${encodeURIComponent(id)}/lead-status`), {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) return null;
      return (await res.json()) as ClientSummary;
    } catch {
      return null;
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
  async importWhatsApp(clientId: string, input: string | { content?: string; contentBase64?: string; misfileAck?: boolean; confirmImport?: boolean; counterpart?: string; firstImportAck?: boolean; fileName?: string }, consent: boolean): Promise<ImportResult> {
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
    // [P16-2] The export file name carries the "WhatsApp Chat with X" title — the authoritative misfile
    // signal. Percent-encoded (UTF-8 titles) so a header never carries raw non-ASCII.
    if (payload.fileName) headers['X-Tovira-Filename'] = encodeURIComponent(payload.fileName);
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
      // [AUDIT gap B] Carry the rep-identification fields the server sends (a two-speaker first import
      // needs the rep to say which speaker is the client) so the single importer can resolve it too.
      const body = (await res.json().catch(() => ({}))) as { message?: string; counterparts?: string[]; suggestion?: { id: string; name: string } | null; needsRepIdentification?: boolean; participants?: string[]; group?: boolean; counterpart?: string | null; clientName?: string; messageCount?: number; dateFrom?: string | null; dateTo?: string | null };
      return {
        ok: false, error: 'misfile',
        message: body.message ?? 'This chat may be filed under the wrong client.',
        counterparts: body.counterparts ?? [],
        suggestion: body.suggestion ?? null,
        needsRepIdentification: body.needsRepIdentification ?? false,
        participants: body.participants ?? [],
        group: body.group ?? false,
        counterpart: body.counterpart ?? null,
        // [P20-6] parts for the web-built mismatch copy (shared date formatter).
        clientName: body.clientName,
        messageCount: body.messageCount,
        dateFrom: body.dateFrom ?? null,
        dateTo: body.dateTo ?? null,
      };
    }
    if (res.status === 400) return { ok: false, error: 'consent', message: 'Please confirm consent to import.' };
    if (res.status === 413) {
      // [IMP-12] Surface the server's message, which states the real limit ("…10 MB…") and the way out.
      const b = (await res.json().catch(() => ({}))) as { message?: string };
      return { ok: false, error: 'too_large', message: b.message ?? 'That export is too large to import.' };
    }
    if (res.status === 422) {
      const body = (await res.json().catch(() => ({}))) as { reason?: string };
      return { ok: false, error: 'not_whatsapp', message: body.reason ?? "That doesn't look like a WhatsApp export." };
    }
    if (res.status === 404) return { ok: false, error: 'not_found', message: 'Client not found.' };
    if (res.status === 402) {
      // [AUDIT item 5] Distinguish the two reasons AI is locked so the rep sees the right action: an
      // exhausted monthly allowance (top up) vs a failed/suspended payment (update card). UI copy only.
      const b = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      if (b.error === 'allowance_exhausted') return { ok: false, error: 'allowance', message: b.message ?? "You've used this month's AI allowance. Top up to import now, or wait for it to reset." };
      return { ok: false, error: 'payment', message: b.message ?? 'Payment failed, so AI is paused. Update your card in Billing to resume.' };
    }
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
