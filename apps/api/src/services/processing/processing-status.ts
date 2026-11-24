import { messagesToRead } from '../import/reading-estimate.js';
import type { NoteRecord, NoteRepository } from '../../ports/note-repository.js';
import type { ClientRepository } from '../../ports/client-repository.js';
import type { FactsRepository } from '../../ports/facts-repository.js';
import type { RequirementRepository } from '../../ports/requirement-repository.js';
import type { MeetingRepository } from '../../ports/meeting-repository.js';
import { extractionState } from '../notes/extraction-state.js';

/**
 * [P65-1 · owner] What Tovira is doing with each thing the rep sent, from the server (never the page that sent it), so
 * it is still right after the rep leaves or closes the app:
 *   working  : queued, transcribing or reading, with the real stage only (no fake progress)
 *   held     : saved, but billing holds it (allowance used up, trial ended, payment failed)
 *   done     : what was found, counted from what was SAVED for that note
 *   failed   : the reason in plain words, and whether Try again can run it again
 * Items finished in the last day are kept, so the client page can show the summary when the rep comes back.
 */
export type CaptureKind = 'chat' | 'voice' | 'typed';
export type ProcessingStage = 'waiting' | 'transcribing' | 'reading';
export type FailureReason = 'ours' | 'recording_missing';
/** [P84-9] 'messages': a chat with more messages to read than the rep has left waits for a pack or the reset. */
export type HoldReason = 'allowance' | 'subscribe' | 'payment' | 'messages';
import { careCount } from '../clients/cares-about.js';
import { clientsById } from '../notes/list-for-clients.js';
export interface FoundCounts { /** [P69] things the client cares about (details, asks, worries) */ caresAbout: number; promises: number; overduePromises: number; dates: number; requirements: number; people: number; needsAnswer: number }
export interface ProcessingItem {
  noteId: string;
  clientId: string;
  clientName: string;
  kind: CaptureKind;
  state: 'working' | 'held' | 'done' | 'failed';
  stage?: ProcessingStage;
  messageCount?: number;
  etaMinutes?: number;
  hold?: HoldReason;
  found?: FoundCounts;
  failure?: { reason: FailureReason; canRetry: boolean };
  startedAt: number;
  settledAt: number | null;
}
export interface ProcessingStatus { items: ProcessingItem[]; working: number }

/** How long the summary of a finished item stays available. */
export const RECENT_MS = 24 * 3_600_000;

export function kindOf(n: Pick<NoteRecord, 'source'>): CaptureKind | null {
  return n.source === 'whatsapp_export' ? 'chat' : n.source === 'voice' ? 'voice' : n.source === 'paste' ? 'typed' : null;
}

/** "Usually about N minutes": a short note about a minute; a voice note or a chat about two; a very large chat longer.
 *  (Lab: 63s for a short note, 98s for 5,615 messages, plus up to 15s waiting for the background pass.) */
export function etaMinutes(kind: CaptureKind, messageCount: number): number {
  if (kind === 'typed') return 1;
  if (kind === 'voice') return 2;
  return messageCount > 6000 ? 5 : 2;
}

export function stageOf(n: Pick<NoteRecord, 'status'>): ProcessingStage {
  if (n.status === 'pending_transcription') return 'transcribing';
  if (n.status === 'extracting') return 'reading';
  return 'waiting';
}

export interface ItemInput {
  note: NoteRecord;
  clientName: string;
  hold: HoldReason | null;
  found: FoundCounts | null;
}

export function toItem({ note: n, clientName, hold, found }: ItemInput): ProcessingItem | null {
  const kind = kindOf(n);
  if (!kind) return null;
  const s = extractionState(n);
  const base = { noteId: n.id, clientId: n.clientId, clientName, kind, startedAt: n.createdAt, settledAt: n.settledAt ?? null };
  const messageCount = kind === 'chat' ? n.messages?.length ?? 0 : undefined;
  if (s === 'queued' || s === 'processing') {
    if (hold) return { ...base, state: 'held', hold, ...(messageCount !== undefined ? { messageCount } : {}) };
    return { ...base, state: 'working', stage: stageOf(n), etaMinutes: etaMinutes(kind, messageCount ?? 0), ...(messageCount !== undefined ? { messageCount } : {}) };
  }
  if (s === 'failed') {
    const missing = n.status === 'transcription_failed';
    // Try again reads it once more from what is stored: the text, or (a voice note with no transcript) the recording
    const canRetry = !missing && (!!n.rawText?.trim() || (kind === 'voice' && !!n.audioKey));
    return { ...base, state: 'failed', failure: { reason: missing ? 'recording_missing' : 'ours', canRetry }, ...(messageCount !== undefined ? { messageCount } : {}) };
  }
  return { ...base, state: 'done', found: found ?? { caresAbout: 0, promises: 0, overduePromises: 0, dates: 0, requirements: 0, people: 0, needsAnswer: 0 }, ...(messageCount !== undefined ? { messageCount } : {}) };
}

export interface ProcessingStatusDeps {
  notes: Pick<NoteRepository, 'listProcessingByUser'>;
  clients: Pick<ClientRepository, 'findByIdForUser'>;
  facts: Pick<FactsRepository, 'listPromisesByNote' | 'listKeyDatesByNote'>;
  requirements: Pick<RequirementRepository, 'listByClient'>;
  meetings: Pick<MeetingRepository, 'findByNoteId'>;
  /** Why a pending note can't be read right now (billing), or null. */
  holdReason: (userId: string) => Promise<HoldReason | null>;
  /** The rep's "today" (YYYY-MM-DD, their time zone), for overdue promises. */
  today: (userId: string, nowMs: number) => Promise<string>;
  /** [P84-9] Messages left this window, and whether a chat's messages were already counted. Optional. */
  messages?: { left: (userId: string) => Promise<number>; isCharged: (userId: string, noteId: string) => Promise<boolean> };
}

/** Counted from what was saved for this note: its promises (open ones past due are overdue), its dates (key dates and a
 *  meeting), its requirements, the people the stored extraction names, and what still needs the rep's answer (a date to
 *  confirm). */
export async function foundFor(deps: ProcessingStatusDeps, userId: string, n: NoteRecord, today: string): Promise<FoundCounts> {
  const [promises, keyDates, reqs, meeting] = await Promise.all([
    deps.facts.listPromisesByNote(userId, n.id),
    deps.facts.listKeyDatesByNote(userId, n.id),
    deps.requirements.listByClient(userId, n.clientId),
    deps.meetings.findByNoteId(userId, n.id).catch(() => null),
  ]);
  const live = promises.filter((p) => !(p as { deletedAt?: number | null }).deletedAt);
  const people = Array.isArray((n.extracted as { people?: unknown[] } | null)?.people) ? (n.extracted as { people: unknown[] }).people.length : 0;
  const toConfirm = (x: { dateStatus?: string | null }) => x.dateStatus === 'to_confirm';
  const noteReqs = reqs.filter((r) => r.noteId === n.id).length;
  return {
    caresAbout: careCount(n.extracted, noteReqs),
    promises: live.length,
    overduePromises: live.filter((p) => !p.done && p.dueDate !== null && p.dueDate < today).length,
    dates: keyDates.length + (meeting ? 1 : 0),
    requirements: noteReqs,
    people,
    needsAnswer: live.filter(toConfirm).length + (meeting && toConfirm(meeting) ? 1 : 0),
  };
}

export class ProcessingStatusService {
  constructor(private readonly deps: ProcessingStatusDeps) {}

  /** [P84-9] A queued chat not yet counted, with more messages to read than are left: it waits for messages. */
  private async messagesHold(userId: string, n: NoteRecord, cached: () => number | null, cache: (v: number) => void): Promise<HoldReason | null> {
    const m = this.deps.messages;
    if (!m || kindOf(n) !== 'chat' || n.status !== 'pending_extraction') return null;
    const toRead = messagesToRead(n.messages ?? []);
    if (toRead <= 0) return null;
    let left = cached();
    if (left === null) { left = await m.left(userId); cache(left); }
    if (toRead <= left) return null;
    return (await m.isCharged(userId, n.id)) ? null : 'messages';
  }

  async status(userId: string, nowMs: number): Promise<ProcessingStatus> {
    const notes = await this.deps.notes.listProcessingByUser(userId, nowMs - RECENT_MS);
    if (notes.length === 0) return { items: [], working: 0 };
    const [hold, today] = await Promise.all([this.deps.holdReason(userId), this.deps.today(userId, nowMs)]);
    let left: number | null = null;
    const byId = await clientsById(this.deps.clients, userId, notes.map((n) => n.clientId)); // [P86] one read, not one per client
    const names = new Map<string, string>([...new Set(notes.map((n) => n.clientId))].map((id) => [id, byId.get(id)?.name ?? '']));
    const items: ProcessingItem[] = [];
    for (const n of notes) {
      const found = n.status === 'extracted' ? await foundFor(this.deps, userId, n, today) : null;
      const item = toItem({ note: n, clientName: names.get(n.clientId)!, hold: hold ?? (await this.messagesHold(userId, n, () => left, (v) => { left = v; })), found });
      if (item) items.push(item);
    }
    items.sort((a, b) => b.startedAt - a.startedAt);
    return { items, working: items.filter((i) => i.state === 'working').length };
  }
}
