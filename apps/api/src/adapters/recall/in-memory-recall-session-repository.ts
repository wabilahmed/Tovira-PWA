import { randomUUID } from 'node:crypto';
import type { RecallMessage, RecallRole, RecallSessionExport, RecallSessionRepository } from '../../ports/recall-session-repository.js';

interface Session { id: string; userId: string; createdAt: number; lastActivityAt: number; }
interface Message extends RecallMessage { userId: string; sessionId: string; seq: number; }

/** In-memory Ask sessions for tests + local runs. */
export class InMemoryRecallSessionRepository implements RecallSessionRepository {
  private readonly sessions: Session[] = [];
  private readonly messages: Message[] = [];
  private seq = 0;

  async activeSession(userId: string, nowMs: number, idleMs: number): Promise<string> {
    const latest = this.sessions
      .filter((s) => s.userId === userId)
      .sort((a, b) => b.lastActivityAt - a.lastActivityAt)[0];
    if (latest && nowMs - latest.lastActivityAt < idleMs) {
      latest.lastActivityAt = nowMs;
      return latest.id;
    }
    const s: Session = { id: randomUUID(), userId, createdAt: nowMs, lastActivityAt: nowMs };
    this.sessions.push(s);
    return s.id;
  }

  async appendMessage(userId: string, sessionId: string, role: RecallRole, content: string, nowMs: number): Promise<void> {
    this.messages.push({ userId, sessionId, role, content, createdAt: nowMs, seq: this.seq++ });
  }

  async recentMessages(userId: string, sessionId: string, n: number): Promise<RecallMessage[]> {
    const all = this.messages
      .filter((m) => m.userId === userId && m.sessionId === sessionId)
      .sort((a, b) => a.seq - b.seq);
    return all.slice(-n).map((m) => ({ role: m.role, content: m.content, createdAt: m.createdAt }));
  }

  async exportForUser(userId: string): Promise<RecallSessionExport[]> {
    return this.sessions
      .filter((s) => s.userId === userId)
      .map((s) => ({
        id: s.id,
        createdAt: s.createdAt,
        messages: this.messages
          .filter((m) => m.userId === userId && m.sessionId === s.id)
          .sort((a, b) => a.seq - b.seq)
          .map((m) => ({ role: m.role, content: m.content, createdAt: m.createdAt })),
      }));
  }

  /** Account delete: drop a rep's sessions + messages (mirrors the pg FK cascade). */
  async purgeUser(userId: string): Promise<void> {
    for (let i = this.sessions.length - 1; i >= 0; i--) if (this.sessions[i]!.userId === userId) this.sessions.splice(i, 1);
    for (let i = this.messages.length - 1; i >= 0; i--) if (this.messages[i]!.userId === userId) this.messages.splice(i, 1);
  }
}
