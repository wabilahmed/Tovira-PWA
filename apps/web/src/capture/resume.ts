/**
 * The resume path (FLOWS-5). The capture pipeline is browser-orchestrated —
 * pending_transcription → pending_extraction → extracted is advanced by the
 * client. The per-client note screen advances only its own client's notes, so a
 * voice note could sit at pending_transcription indefinitely if the rep never
 * reopened that client. This sweep runs on app load, across ALL clients, so a
 * recording never stalls in limbo. Best-effort: a failing step never throws.
 */
export interface ResumeApi {
  listPendingNotes(): Promise<Array<{ id: string; status: string }>>;
  transcribeNote(id: string): Promise<unknown>;
  extractNote(id: string): Promise<{ status?: string }>;
}

export async function resumePendingNotes(api: ResumeApi): Promise<number> {
  const pending = await api.listPendingNotes();
  if (pending.length === 0) return 0;

  // Phase 1: transcribe anything awaiting transcription.
  await Promise.all(
    pending
      .filter((n) => n.status === 'pending_transcription')
      .map((n) => api.transcribeNote(n.id).catch(() => undefined)),
  );

  // Phase 2: extract everything now extractable — re-list so a note we just
  // transcribed (now pending_extraction) is carried through in the same sweep.
  const next = await api.listPendingNotes();
  await Promise.all(
    next
      .filter((n) => n.status === 'pending_extraction')
      .map((n) => api.extractNote(n.id).catch(() => undefined)),
  );

  return pending.length;
}
