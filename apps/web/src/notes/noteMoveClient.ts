/**
 * [NOTE-MOVE] Client for fixing a misfiled note — surface the server's move suggestions, preview what
 * a move carries, move the note (and everything derived from it) to the right client, and undo that
 * move by REVERSING it (not `/notes/:id/undo`, which deletes the note — see BLOCKERS.md). The note's
 * content and facts follow it; nothing is lost, so "undo" restores rather than destroys.
 */

/** A note that looks filed under the wrong client — a soft "move it?" the rep resolves. */
export interface MoveSuggestion {
  noteId: string;
  fromClientId: string;
  toClientId: string | null;
  toClientName: string | null;
  mentioned: string[];
  reason: string;
}

/** What a move will carry, shown before the rep confirms. */
export interface MovePreview {
  noteId: string;
  fromClientId: string;
  counts: { messages: number; promises: number; keyDates: number; meetings: number; people: number; requirements: number };
}

export interface MoveResult {
  ok: boolean;
  counts?: MovePreview['counts'];
}

export class NoteMoveClient {
  constructor(private readonly baseUrl: string = '') {}

  /** The pending move suggestions ride the confirmation queue payload. */
  async listMoveSuggestions(): Promise<MoveSuggestion[]> {
    try {
      const res = await fetch(`${this.baseUrl}/confirmations`, { credentials: 'include' });
      if (res.status !== 200) return [];
      return ((await res.json()) as { moveSuggestions?: MoveSuggestion[] }).moveSuggestions ?? [];
    } catch {
      return [];
    }
  }

  /** Read-only: exactly what a move will carry (counts), so the rep confirms a known set. */
  async preview(noteId: string): Promise<MovePreview | null> {
    try {
      const res = await fetch(`${this.baseUrl}/notes/${noteId}/move-preview`, { credentials: 'include' });
      if (res.status !== 200) return null;
      return (await res.json()) as MovePreview;
    } catch {
      return null;
    }
  }

  /** Move the note (and its messages, spine rows, meetings, requirements/matches) to `toClientId`. */
  async move(noteId: string, toClientId: string): Promise<MoveResult | null> {
    try {
      const res = await fetch(`${this.baseUrl}/notes/${noteId}/move`, {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ toClientId }),
      });
      if (res.status !== 200) return null;
      return (await res.json()) as MoveResult;
    } catch {
      return null;
    }
  }

  /**
   * Undo a move by moving the note BACK to the client it came from — a reverse move, which restores
   * the note, its facts and pointers and recomputes both clients' last-contact. We never call
   * `/notes/:id/undo` here: that deletes the note (import-undo), which would lose the rep's capture.
   */
  undo(noteId: string, originalClientId: string): Promise<MoveResult | null> {
    return this.move(noteId, originalClientId);
  }
}
