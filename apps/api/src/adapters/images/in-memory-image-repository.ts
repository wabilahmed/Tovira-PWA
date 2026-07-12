import { randomUUID } from 'node:crypto';
import type { ImageRecord, ImageRepository, NewImage } from '../../ports/image-repository.js';

/** In-memory gallery store for tests. */
export class InMemoryImageRepository implements ImageRepository {
  private readonly byId = new Map<string, ImageRecord>();
  private seq = 0;

  async create(userId: string, image: NewImage): Promise<ImageRecord> {
    const record: ImageRecord = {
      id: randomUUID(),
      userId,
      clientId: image.clientId,
      storageKey: image.storageKey,
      contentType: image.contentType,
      createdAt: Date.now() + this.seq++,
    };
    this.byId.set(record.id, record);
    return record;
  }

  async listByClient(userId: string, clientId: string): Promise<ImageRecord[]> {
    return [...this.byId.values()]
      .filter((i) => i.userId === userId && i.clientId === clientId)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  async findByIdForUser(userId: string, id: string): Promise<ImageRecord | null> {
    const i = this.byId.get(id);
    return i && i.userId === userId ? i : null;
  }
}
