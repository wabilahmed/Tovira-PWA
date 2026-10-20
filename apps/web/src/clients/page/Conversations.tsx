import { useState, type ReactNode } from 'react';
import type { NoteSummary } from '../clientsClient.js';
import { extractionStateOf } from '../clientsClient.js';
import { NoteState, NoteSubscribe } from '../NotesTimeline.js';
import { CeilingNotice } from '../../import/CeilingNotice.js';
import { MoveNoteControl, type MoveNoteApi } from '../../notes/MoveNoteControl.js';
import type { ClientOption } from '../../meetings/Meetings.js';
import { ReceiptThread } from '../../receipts/ReceiptThread.js';
import { formatBody } from '../../format/dates.js';
import type { ConversationEntry } from './clientPageClient.js';

/**
 * [P36-5] The client's conversations — each imported chat, voice note and pasted message its own collapsed
 * entry with a plain title ("WhatsApp chat · 16 Oct 2026 · 187 messages"). Opened, it reads as WhatsApp does,
 * through the shared <ReceiptThread> (newest day last, older messages on scroll-up). Never a raw "[ISO] Name:"
 * line, never a source enum. The note's state (queued / analysing / held / failed), the follow-up draft and the
 * move-to-another-client control stay with each entry.
 */
const KIND_LABEL: Record<ConversationEntry['kind'], string> = { whatsapp: 'WhatsApp chat', voice: 'Voice note', paste: 'Pasted message', note: 'Note' };

function kindOf(n: NoteSummary, entry?: ConversationEntry): ConversationEntry['kind'] {
  if (entry) return entry.kind;
  const src = n.source as string;
  return src === 'whatsapp_export' ? 'whatsapp' : src === 'voice' ? 'voice' : src === 'paste' ? 'paste' : 'note';
}

export function conversationTitle(n: NoteSummary, entry?: ConversationEntry): string {
  const count = entry?.messageCount ?? null;
  return [KIND_LABEL[kindOf(n, entry)], formatBody(entry?.lastAt ?? n.createdAt), count ? `${count} message${count === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ');
}

/** The section summary: "1 WhatsApp chat · 187 messages · imported 19 Oct 2026", or null (→ "Nothing yet"). */
export function conversationsSummary(entries: ConversationEntry[]): string | null {
  if (entries.length === 0) return null;
  const counts = new Map<ConversationEntry['kind'], number>();
  for (const e of entries) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
  const plural = (k: ConversationEntry['kind'], n: number) => `${n} ${KIND_LABEL[k]}${n === 1 ? '' : 's'}`;
  const kinds = (['whatsapp', 'voice', 'paste', 'note'] as const).filter((k) => counts.has(k)).map((k) => plural(k, counts.get(k)!));
  const messages = entries.reduce((s, e) => s + (e.messageCount ?? 0), 0);
  const latest = entries.reduce((a, b) => (b.createdAt > a.createdAt ? b : a));
  return [kinds.join(' · '), messages > 0 ? `${messages} messages` : null, `${latest.kind === 'whatsapp' ? 'imported' : 'added'} ${formatBody(latest.createdAt)}`].filter(Boolean).join(' · ');
}

export function Conversations({ notes, entries, ceilingNoteIds, renderFollowUp, move, onSubscribe }: {
  notes: NoteSummary[];
  /** The overview's entries (kind, message count, latest time), by note id. */
  entries: ConversationEntry[];
  ceilingNoteIds: Set<string>;
  renderFollowUp?: (noteId: string) => ReactNode;
  move?: { api: MoveNoteApi; clientId: string; clients: ClientOption[]; onMoved?: (noteId: string) => void };
  onSubscribe?: (plan: 'monthly' | 'annual') => void;
}): JSX.Element {
  const [openId, setOpenId] = useState<string | null>(null);
  if (notes.length === 0) return <p style={{ color: 'var(--text-secondary)', margin: 0 }}>No conversations yet. Use Add to record a voice note, paste a message or import a chat.</p>;
  const byId = new Map(entries.map((e) => [e.noteId, e]));
  const ordered = notes.slice().sort((a, b) => {
    const at = (n: NoteSummary) => byId.get(n.id)?.lastAt ?? new Date(n.createdAt).toISOString();
    return at(b).localeCompare(at(a));
  });
  return (
    <ul className="tov-convos" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
      {ordered.map((n) => {
        const entry = byId.get(n.id);
        const ceiling = ceilingNoteIds.has(n.id);
        const state = extractionStateOf(n);
        const inProgress = state === 'queued' || state === 'processing';
        const open = openId === n.id;
        return (
          <li key={n.id} className="tov-convo" data-testid="conversation">
            <button type="button" className="tov-convo__btn" aria-expanded={open} onClick={() => setOpenId(open ? null : n.id)}>
              <span className="tov-convo__title">{conversationTitle(n, entry)}</span>
              <small className="tov-convo__state"><NoteState note={n} ceiling={ceiling} /></small>
            </button>
            <NoteSubscribe note={n} ceiling={ceiling} onSubscribe={onSubscribe} />
            {open && (
              <div className="tov-convo__body">
                {n.restricted ? (
                  <em data-testid="note-restricted" style={{ color: 'var(--text-secondary)' }}>{n.restrictionNotice ?? 'Restricted while a privacy request is reviewed.'}</em>
                ) : n.status === 'transcription_failed' ? (
                  <em>The recording couldn’t be found, so this note couldn’t be transcribed.</em>
                ) : n.rawText === null ? (
                  <em>Transcribing…</em>
                ) : (
                  <ReceiptThread conversation={n.id} refInfo={{ noteId: n.id }} />
                )}
                {ceiling && <CeilingNotice />}
                {!ceiling && n.rawText && renderFollowUp?.(n.id)}
                {!ceiling && !inProgress && !n.restricted && move && (
                  <MoveNoteControl api={move.api} noteId={n.id} fromClientId={move.clientId} clients={move.clients} onMoved={move.onMoved} />
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
