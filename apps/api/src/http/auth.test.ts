import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { AuthService } from '../services/auth/auth-service.js';
import { ScryptHasher } from '../services/auth/password.js';
import { InMemoryUserRepository } from '../adapters/auth/in-memory-user-repository.js';
import { InMemorySessionRepository } from '../adapters/auth/in-memory-session-repository.js';
import { InMemoryClientRepository } from '../adapters/clients/in-memory-client-repository.js';
import { InMemoryNoteRepository } from '../adapters/notes/in-memory-note-repository.js';
import { InMemoryStorage } from '../adapters/storage/in-memory.js';

// A stub Pool so /health has something to call; auth tests don't touch the DB.
const stubPool = { query: async () => ({ rows: [] }) } as unknown as import('pg').Pool;

let server: Server;
let base: string;

beforeAll(async () => {
  const auth = new AuthService({
    users: new InMemoryUserRepository(),
    sessions: new InMemorySessionRepository(),
    hasher: new ScryptHasher(),
    sessionTtlMs: 7 * 24 * 60 * 60 * 1000,
  });
  server = createApiServer({
    pool: stubPool,
    auth,
    clients: new InMemoryClientRepository(),
    notes: new InMemoryNoteRepository(),
    storage: new InMemoryStorage(),
  });
  await new Promise<void>((r) => server.listen(0, r));
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('auth HTTP endpoints', () => {
  it('signs up: 201, returns user + token, sets an HttpOnly session cookie', async () => {
    const res = await post('/auth/signup', { email: 'a@example.com', password: 'password123' });
    expect(res.status).toBe(201);
    const json = (await res.json()) as { user: { id: string; email: string }; token: string };
    expect(json.user.email).toBe('a@example.com');
    expect(json).not.toHaveProperty('user.passwordHash');
    expect(json.token).toBeTruthy();
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(/session=/);
    expect(cookie.toLowerCase()).toContain('httponly');
  });

  it('authorizes a protected route via Bearer token, and again after "refresh"', async () => {
    const signup = await post('/auth/signup', { email: 'b@example.com', password: 'password123' });
    const { token } = (await signup.json()) as { token: string };

    const me1 = await fetch(`${base}/me`, { headers: { authorization: `Bearer ${token}` } });
    expect(me1.status).toBe(200);
    const me2 = await fetch(`${base}/me`, { headers: { authorization: `Bearer ${token}` } });
    expect(me2.status).toBe(200); // still authenticated on a fresh request
  });

  it('authorizes a protected route via the session cookie', async () => {
    const signup = await post('/auth/signup', { email: 'cookie@example.com', password: 'password123' });
    const { token } = (await signup.json()) as { token: string };
    const me = await fetch(`${base}/me`, { headers: { cookie: `session=${token}` } });
    expect(me.status).toBe(200);
  });

  // NEGATIVE
  it('rejects a protected route with no token: 401, no data', async () => {
    const res = await fetch(`${base}/me`);
    expect(res.status).toBe(401);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json).not.toHaveProperty('user');
    expect(json.error).toBeTruthy();
  });

  it('rejects a protected route with a garbage token: 401', async () => {
    const res = await fetch(`${base}/me`, { headers: { authorization: 'Bearer nonsense' } });
    expect(res.status).toBe(401);
  });

  it('rejects duplicate signup: 409, no duplicate account', async () => {
    await post('/auth/signup', { email: 'dup@example.com', password: 'password123' });
    const res = await post('/auth/signup', { email: 'dup@example.com', password: 'password123' });
    expect(res.status).toBe(409);
  });

  it('does not reveal whether an email exists (no user enumeration)', async () => {
    await post('/auth/signup', { email: 'real@example.com', password: 'password123' });
    const wrongPw = await post('/auth/login', { email: 'real@example.com', password: 'WRONG' });
    const unknown = await post('/auth/login', { email: 'ghost@example.com', password: 'password123' });
    expect(wrongPw.status).toBe(401);
    expect(unknown.status).toBe(401);
    const a = (await wrongPw.json()) as { message?: string };
    const b = (await unknown.json()) as { message?: string };
    expect(a.message).toBe(b.message); // identical → no leak
  });

  it('invalidates the session on logout: protected route then returns 401', async () => {
    const signup = await post('/auth/signup', { email: 'out@example.com', password: 'password123' });
    const { token } = (await signup.json()) as { token: string };
    expect((await fetch(`${base}/me`, { headers: { authorization: `Bearer ${token}` } })).status).toBe(200);

    const logout = await post('/auth/logout', {}, { authorization: `Bearer ${token}` });
    expect(logout.status).toBe(200);

    const after = await fetch(`${base}/me`, { headers: { authorization: `Bearer ${token}` } });
    expect(after.status).toBe(401);
  });
});
