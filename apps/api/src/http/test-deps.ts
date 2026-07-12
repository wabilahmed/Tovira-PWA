import type { Pool } from 'pg';
import type { ApiDeps } from '../server.js';
import { AuthService } from '../services/auth/auth-service.js';
import { ScryptHasher } from '../services/auth/password.js';
import { InMemoryUserRepository } from '../adapters/auth/in-memory-user-repository.js';
import { InMemorySessionRepository } from '../adapters/auth/in-memory-session-repository.js';
import { InMemoryClientRepository } from '../adapters/clients/in-memory-client-repository.js';
import { InMemoryNoteRepository } from '../adapters/notes/in-memory-note-repository.js';
import { InMemoryStorage } from '../adapters/storage/in-memory.js';
import { StubTranscriber } from '../adapters/transcription/stub.js';
import { TranscriptionService } from '../services/transcription/transcription-service.js';

export interface TestDeps extends ApiDeps {
  storage: InMemoryStorage;
  notes: InMemoryNoteRepository;
  clients: InMemoryClientRepository;
}

/**
 * Build a full in-memory ApiDeps for HTTP tests. Central so adding a dependency
 * touches one place, not every test file.
 */
export function buildInMemoryDeps(overrides: Partial<ApiDeps> = {}): TestDeps {
  const stubPool = { query: async () => ({ rows: [] }) } as unknown as Pool;
  const auth = new AuthService({
    users: new InMemoryUserRepository(),
    sessions: new InMemorySessionRepository(),
    hasher: new ScryptHasher(),
    sessionTtlMs: 60 * 60 * 1000,
  });
  const notes = new InMemoryNoteRepository();
  const storage = new InMemoryStorage();
  const transcription = new TranscriptionService(new StubTranscriber('clear transcript'), notes, storage);
  return {
    pool: stubPool,
    auth,
    clients: new InMemoryClientRepository(),
    notes,
    storage,
    transcription,
    ...overrides,
  } as TestDeps;
}
