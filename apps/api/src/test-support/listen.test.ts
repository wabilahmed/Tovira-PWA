import { describe, it, expect } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listenForTest } from './listen.js';

// [test infra] The port-clash flake: tests bound the wildcard address on a random port, and a stray local server holding
// 127.0.0.1 on the same port answered instead (HTML where JSON was expected). listenForTest binds 127.0.0.1 itself, on a
// free port the OS picks, stamps every response with a per-server random token, and proves the token comes back before
// any test runs.
const close = (s: Server) => new Promise<void>((r) => s.close(() => r()));

describe('[test infra] listenForTest', () => {
  it('binds 127.0.0.1 on a random free port and returns its base URL', async () => {
    const s = createServer((_q, res) => res.end('ok'));
    const base = await listenForTest(s);
    const a = s.address() as AddressInfo;
    expect(a.address).toBe('127.0.0.1');
    expect(a.port).toBeGreaterThan(0);
    expect(base).toBe(`http://127.0.0.1:${a.port}`);
    await close(s);
  });

  it('every response carries the server\'s own token', async () => {
    const s = createServer((_q, res) => res.end('ok'));
    const base = await listenForTest(s);
    const t1 = (await fetch(`${base}/anything`)).headers.get('x-test-server');
    const t2 = (await fetch(`${base}/else`)).headers.get('x-test-server');
    expect(t1).toMatch(/^[0-9a-f]{32}$/);
    expect(t2).toBe(t1);
    await close(s);
  });

  it('NEGATIVE: refuses to start when the probe answer does not carry the token (another server answered)', async () => {
    const s = createServer((_q, res) => res.end('ok'));
    const stray = async () => new Response('<!DOCTYPE html>', { status: 200 });
    await expect(listenForTest(s, { probe: stray })).rejects.toThrow(/not our server/);
    await close(s);
  });

  it('NEGATIVE: every API test starts its server through listenForTest (no wildcard listen left)', () => {
    const dir = fileURLToPath(new URL('../http/', import.meta.url));
    const offenders = readdirSync(dir).filter((f) => f.endsWith('.test.ts')).filter((f) => /\.listen\(0\s*,\s*r\)/.test(readFileSync(join(dir, f), 'utf8')));
    expect(offenders).toEqual([]);
  });
});
