import { describe, it, expect, vi } from 'vitest';
import { resumePendingNotes, type ResumeApi } from './resume.js';

const note = (id: string, status: string) => ({ id, status });

describe('[FLOWS-5] resumePendingNotes — a voice note never stalls in limbo', () => {
  it('transcribes then extracts a note that is still awaiting transcription (two-phase, one sweep)', async () => {
    // First list: the note is pending_transcription. After transcribe it becomes
    // pending_extraction — the re-list catches it and extracts it in the same run.
    const listPendingNotes = vi.fn()
      .mockResolvedValueOnce([note('n1', 'pending_transcription')])
      .mockResolvedValueOnce([note('n1', 'pending_extraction')]);
    const api: ResumeApi = { listPendingNotes, transcribeNote: vi.fn().mockResolvedValue({}), extractNote: vi.fn().mockResolvedValue({}) };
    await resumePendingNotes(api);
    expect(api.transcribeNote).toHaveBeenCalledWith('n1');
    expect(api.extractNote).toHaveBeenCalledWith('n1');
  });

  it('extracts a note already awaiting extraction (does not transcribe it)', async () => {
    const listPendingNotes = vi.fn().mockResolvedValue([note('n2', 'pending_extraction')]);
    const api: ResumeApi = { listPendingNotes, transcribeNote: vi.fn(), extractNote: vi.fn().mockResolvedValue({}) };
    await resumePendingNotes(api);
    expect(api.transcribeNote).not.toHaveBeenCalled();
    expect(api.extractNote).toHaveBeenCalledWith('n2');
  });

  it('does nothing when there are no pending notes', async () => {
    const api: ResumeApi = { listPendingNotes: vi.fn().mockResolvedValue([]), transcribeNote: vi.fn(), extractNote: vi.fn() };
    expect(await resumePendingNotes(api)).toBe(0);
    expect(api.transcribeNote).not.toHaveBeenCalled();
    expect(api.extractNote).not.toHaveBeenCalled();
  });

  // A failing step must never throw out of the resume sweep (best-effort, on load).
  it('swallows per-note failures so one stuck note never breaks the sweep', async () => {
    const listPendingNotes = vi.fn().mockResolvedValue([note('a', 'pending_transcription'), note('b', 'pending_extraction')]);
    const api: ResumeApi = {
      listPendingNotes,
      transcribeNote: vi.fn().mockRejectedValue(new Error('groq down')),
      extractNote: vi.fn().mockRejectedValue(new Error('busy')),
    };
    await expect(resumePendingNotes(api)).resolves.toBeGreaterThanOrEqual(0);
  });
});
