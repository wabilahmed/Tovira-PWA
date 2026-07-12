import { randomUUID } from 'node:crypto';
import type { MeetingRecord, MeetingRepository, NewMeeting } from '../../ports/meeting-repository.js';

/** In-memory calendar for tests. */
export class InMemoryMeetingRepository implements MeetingRepository {
  private readonly byId = new Map<string, MeetingRecord>();
  private seq = 0;

  async create(userId: string, meeting: NewMeeting): Promise<MeetingRecord> {
    const record: MeetingRecord = {
      id: randomUUID(),
      userId,
      clientId: meeting.clientId,
      datetime: meeting.datetime,
      datetimeRaw: meeting.datetimeRaw,
      title: meeting.title,
      confirmed: meeting.confirmed,
      nudgedAt: null,
      createdAt: Date.now() + this.seq++,
    };
    this.byId.set(record.id, record);
    return record;
  }

  async listByUser(userId: string): Promise<MeetingRecord[]> {
    return [...this.byId.values()].filter((m) => m.userId === userId).sort((a, b) => {
      return (a.datetime ?? '').localeCompare(b.datetime ?? '');
    });
  }

  async findByIdForUser(userId: string, id: string): Promise<MeetingRecord | null> {
    const m = this.byId.get(id);
    return m && m.userId === userId ? m : null;
  }

  async delete(userId: string, id: string): Promise<boolean> {
    const m = this.byId.get(id);
    if (!m || m.userId !== userId) return false;
    this.byId.delete(id);
    return true;
  }

  async dueForNudge(userId: string, fromIso: string, toIso: string): Promise<MeetingRecord[]> {
    return [...this.byId.values()].filter(
      (m) =>
        m.userId === userId &&
        m.confirmed &&
        m.nudgedAt === null &&
        m.datetime !== null &&
        m.datetime >= fromIso &&
        m.datetime <= toIso,
    );
  }

  async markNudged(userId: string, id: string, at: number): Promise<void> {
    const m = this.byId.get(id);
    if (m && m.userId === userId) m.nudgedAt = at;
  }
}
