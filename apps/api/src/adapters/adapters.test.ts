import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FsStorage } from './storage/fs.js';
import { StubAuthProvider } from './auth/stub.js';
import { LocalScheduler } from './scheduler/local.js';

// [P0-2] Each external dependency has a working LOCAL implementation behind its
// interface, so the whole product can run on a laptop with no cloud.
describe('local adapters', () => {
  describe('FsStorage', () => {
    it('round-trips bytes by key', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'tovira-storage-'));
      const storage = new FsStorage(dir);
      const data = new TextEncoder().encode('hello');
      expect(await storage.exists('a/b.txt')).toBe(false);
      await storage.put('a/b.txt', data);
      expect(await storage.exists('a/b.txt')).toBe(true);
      const got = await storage.get('a/b.txt');
      expect(new TextDecoder().decode(got)).toBe('hello');
    });

    it('refuses keys that escape the base directory', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'tovira-storage-'));
      const storage = new FsStorage(dir);
      await expect(storage.put('../escape.txt', new Uint8Array())).rejects.toThrow();
    });
  });

  describe('StubAuthProvider', () => {
    it('resolves a valid stub token to an identity', async () => {
      const auth = new StubAuthProvider();
      expect(await auth.verifyToken('stub:user-123')).toEqual({ userId: 'user-123' });
    });

    it('rejects a malformed/empty token', async () => {
      const auth = new StubAuthProvider();
      expect(await auth.verifyToken('garbage')).toBeNull();
      expect(await auth.verifyToken('')).toBeNull();
    });
  });

  describe('LocalScheduler', () => {
    it('registers and triggers a job by name', async () => {
      const scheduler = new LocalScheduler();
      let ran = 0;
      scheduler.register({ name: 'daily-scan', run: async () => { ran += 1; } });
      expect(scheduler.list()).toEqual(['daily-scan']);
      await scheduler.trigger('daily-scan');
      expect(ran).toBe(1);
    });

    it('throws when triggering an unknown job', async () => {
      const scheduler = new LocalScheduler();
      await expect(scheduler.trigger('nope')).rejects.toThrow();
    });
  });
});
