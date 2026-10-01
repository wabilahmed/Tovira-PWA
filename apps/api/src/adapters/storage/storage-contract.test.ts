import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Storage } from '../../ports/storage.js';
import { InMemoryStorage } from './in-memory.js';
import { FsStorage } from './fs.js';
import { S3Storage, type S3SendClient } from './s3.js';

/** In-memory S3 with REAL S3 semantics (not a call-assertion mock): bytes round-trip, GetObject on a
 *  missing key throws NoSuchKey, HeadObject throws 404 NotFound, DeleteObject is idempotent. Drives the
 *  S3Storage adapter through the same contract as the other backends. */
class FakeS3 implements S3SendClient {
  private readonly store = new Map<string, Uint8Array>();
  async send(command: object): Promise<unknown> {
    const name = command.constructor.name;
    const input = (command as { input: { Key: string; Body?: Uint8Array } }).input;
    switch (name) {
      case 'PutObjectCommand':
        this.store.set(input.Key, input.Body as Uint8Array);
        return {};
      case 'GetObjectCommand': {
        const b = this.store.get(input.Key);
        if (!b) throw Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } });
        return { Body: { transformToByteArray: async (): Promise<Uint8Array> => b } };
      }
      case 'HeadObjectCommand':
        if (!this.store.has(input.Key)) throw Object.assign(new Error('NotFound'), { name: 'NotFound', $metadata: { httpStatusCode: 404 } });
        return {};
      case 'DeleteObjectCommand':
        this.store.delete(input.Key); // idempotent, like real S3
        return {};
      default:
        throw new Error(`unexpected S3 command: ${name}`);
    }
  }
}

const BACKENDS: Array<[string, () => Promise<{ storage: Storage; done?: () => Promise<void> }>]> = [
  ['InMemoryStorage', async () => ({ storage: new InMemoryStorage() })],
  ['FsStorage', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tovira-stg-'));
    return { storage: new FsStorage(dir), done: () => rm(dir, { recursive: true, force: true }) };
  }],
  ['S3Storage (fake client)', async () => ({ storage: new S3Storage({ bucket: 'media', region: 'eu-north-1', client: new FakeS3() }) })],
];

const KEY = 'audio/u1/11111111-2222-3333-4444-555555555555.webm';
const BYTES = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 9, 8, 7, 6, 5]);

for (const [name, make] of BACKENDS) {
  describe(`[STORAGE] ${name} satisfies the Storage port contract`, () => {
    let storage: Storage;
    let done: (() => Promise<void>) | undefined;
    beforeEach(async () => { ({ storage, done } = await make()); });
    afterEach(async () => { await done?.(); });

    it('put → get round-trips the exact bytes', async () => {
      await storage.put(KEY, BYTES);
      expect([...(await storage.get(KEY))]).toEqual([...BYTES]);
    });

    it('get of a missing key throws', async () => {
      await expect(storage.get('audio/u1/does-not-exist.webm')).rejects.toBeTruthy();
    });

    it('exists reflects presence (false → true → false after delete)', async () => {
      expect(await storage.exists(KEY)).toBe(false);
      await storage.put(KEY, BYTES);
      expect(await storage.exists(KEY)).toBe(true);
      await storage.delete(KEY);
      expect(await storage.exists(KEY)).toBe(false);
    });

    it('delete removes the object, and deleting an already-deleted key is a no-op (idempotent)', async () => {
      await storage.put(KEY, BYTES);
      await storage.delete(KEY);
      await expect(storage.get(KEY)).rejects.toBeTruthy(); // gone
      await expect(storage.delete(KEY)).resolves.toBeUndefined(); // second delete does not throw
    });
  });
}
