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
import { StubModelClient } from '../adapters/model/stub.js';
import { InMemoryFactsRepository } from '../adapters/facts/in-memory-facts-repository.js';
import { InMemoryExtractionLogRepository } from '../adapters/logs/in-memory-extraction-log-repository.js';
import { StubEmbedder } from '../adapters/embedding/stub.js';
import { ExtractionService } from '../services/extraction/extraction-service.js';
import { BriefService } from '../services/brief/brief-service.js';

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
  const clients = new InMemoryClientRepository();
  const facts = new InMemoryFactsRepository();
  const transcription = new TranscriptionService(new StubTranscriber('clear transcript'), notes, storage);
  const embedder = new StubEmbedder(8);
  const extraction = new ExtractionService(
    new StubModelClient(),
    clients,
    notes,
    facts,
    embedder,
    new InMemoryExtractionLogRepository(),
    'stub',
  );
  const brief = new BriefService(clients, notes, facts, embedder);
  return {
    pool: stubPool,
    auth,
    clients,
    notes,
    storage,
    transcription,
    extraction,
    facts,
    brief,
    ...overrides,
  } as TestDeps;
}
