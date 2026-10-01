import { mkdir, readFile, writeFile, access, rm, readdir } from 'node:fs/promises';
import { dirname, join, relative, resolve, isAbsolute } from 'node:path';
import type { Storage } from '../../ports/storage.js';

/**
 * Local stand-in for S3: stores blobs under a base directory. Keys are confined
 * to the base dir (no path traversal), mirroring an object store's flat keyspace.
 */
export class FsStorage implements Storage {
  private readonly base: string;

  constructor(baseDir: string) {
    this.base = resolve(baseDir);
  }

  private resolveKey(key: string): string {
    const full = resolve(this.base, key);
    const rel = relative(this.base, full);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      throw new Error(`invalid storage key (escapes base): ${key}`);
    }
    return full;
  }

  async put(key: string, data: Uint8Array): Promise<void> {
    const full = this.resolveKey(key);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, data);
  }

  async get(key: string): Promise<Uint8Array> {
    return readFile(this.resolveKey(key));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await access(this.resolveKey(key));
      return true;
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolveKey(key), { force: true }); // force: missing key is a no-op
  }

  async list(prefix: string): Promise<string[]> {
    // Walk the tree and return keys (base-relative, forward-slashed) that start with the prefix.
    const out: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return; // missing dir → no keys
      }
      for (const e of entries) {
        const full = join(dir, e.name);
        if (e.isDirectory()) await walk(full);
        else {
          const key = relative(this.base, full).split(/[\\/]/).join('/');
          if (key.startsWith(prefix)) out.push(key);
        }
      }
    };
    await walk(this.base);
    return out;
  }
}

/** Resolve a storage key to an absolute path (exported for parity with prod URLs). */
export function storagePath(base: string, key: string): string {
  return join(resolve(base), key);
}
