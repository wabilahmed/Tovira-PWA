import type { Storage } from '../../ports/storage.js';

/** In-memory blob storage for tests. */
export class InMemoryStorage implements Storage {
  private readonly blobs = new Map<string, Uint8Array>();

  async put(key: string, data: Uint8Array): Promise<void> {
    this.blobs.set(key, data);
  }

  async get(key: string): Promise<Uint8Array> {
    const data = this.blobs.get(key);
    if (!data) throw new Error(`no such object: ${key}`);
    return data;
  }

  async exists(key: string): Promise<boolean> {
    return this.blobs.has(key);
  }

  has(key: string): boolean {
    return this.blobs.has(key);
  }
}
