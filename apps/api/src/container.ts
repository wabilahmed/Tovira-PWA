import type { Pool } from 'pg';
import type { AppConfig } from './config.js';
import type { ModelClient } from './ports/model.js';
import type { AuthProvider } from './ports/auth.js';
import type { Storage } from './ports/storage.js';
import type { Scheduler } from './ports/scheduler.js';
import type { UserRepository } from './ports/user-repository.js';
import type { SessionRepository } from './ports/session-repository.js';
import { StubModelClient } from './adapters/model/stub.js';
import { AnthropicModelClient } from './adapters/model/anthropic.js';
import { StubAuthProvider } from './adapters/auth/stub.js';
import { FsStorage } from './adapters/storage/fs.js';
import { LocalScheduler } from './adapters/scheduler/local.js';
import { InMemoryUserRepository } from './adapters/auth/in-memory-user-repository.js';
import { InMemorySessionRepository } from './adapters/auth/in-memory-session-repository.js';
import { PgUserRepository } from './adapters/auth/pg-user-repository.js';
import { PgSessionRepository } from './adapters/auth/pg-session-repository.js';
import { AuthService } from './services/auth/auth-service.js';
import { ScryptHasher } from './services/auth/password.js';
import type { ClientRepository } from './ports/client-repository.js';
import { InMemoryClientRepository } from './adapters/clients/in-memory-client-repository.js';
import { PgClientRepository } from './adapters/clients/pg-client-repository.js';
import type { NoteRepository } from './ports/note-repository.js';
import { InMemoryNoteRepository } from './adapters/notes/in-memory-note-repository.js';
import { PgNoteRepository } from './adapters/notes/pg-note-repository.js';
import type { Transcriber } from './ports/transcriber.js';
import { StubTranscriber } from './adapters/transcription/stub.js';
import { GroqTranscriber } from './adapters/transcription/groq.js';
import { TranscriptionService } from './services/transcription/transcription-service.js';
import type { FactsRepository } from './ports/facts-repository.js';
import { InMemoryFactsRepository } from './adapters/facts/in-memory-facts-repository.js';
import { PgFactsRepository } from './adapters/facts/pg-facts-repository.js';
import type { Embedder } from './ports/embedder.js';
import { StubEmbedder } from './adapters/embedding/stub.js';
import { ExtractionService } from './services/extraction/extraction-service.js';

/**
 * Composition root. The ONLY place that names concrete adapters — it maps config
 * to implementations so business logic never imports a vendor SDK. Swapping a
 * provider (stub → Anthropic, fs → S3, …) happens here, driven by config.
 */

export interface Services {
  model: ModelClient;
  auth: AuthProvider;
  storage: Storage;
  scheduler: Scheduler;
}

export function createModelClient(config: AppConfig): ModelClient {
  if (config.modelProvider === 'anthropic') {
    return new AnthropicModelClient({
      apiKey: config.anthropicApiKey ?? '',
      baseUrl: config.anthropicBaseUrl,
      model: config.anthropicModel,
    });
  }
  return new StubModelClient();
}

export function createServices(config: AppConfig): Services {
  return {
    model: createModelClient(config),
    auth: new StubAuthProvider(),
    storage: new FsStorage(config.storageDir),
    scheduler: new LocalScheduler(),
  };
}

/** Build the auth service, selecting the user/session store from config. */
export function createAuthService(config: AppConfig, pool?: Pool): AuthService {
  let users: UserRepository;
  let sessions: SessionRepository;
  if (config.authStore === 'postgres') {
    if (!pool) throw new Error('authStore=postgres requires a database pool');
    users = new PgUserRepository(pool);
    sessions = new PgSessionRepository(pool);
  } else {
    users = new InMemoryUserRepository();
    sessions = new InMemorySessionRepository();
  }
  return new AuthService({
    users,
    sessions,
    hasher: new ScryptHasher(),
    sessionTtlMs: config.sessionTtlHours * 60 * 60 * 1000,
  });
}

/** Build the client repository, selecting the store from config (RLS-backed on pg). */
export function createClientRepository(config: AppConfig, pool?: Pool): ClientRepository {
  if (config.authStore === 'postgres') {
    if (!pool) throw new Error('authStore=postgres requires a database pool');
    return new PgClientRepository(pool);
  }
  return new InMemoryClientRepository();
}

/** Build the note repository, selecting the store from config (RLS-backed on pg). */
export function createNoteRepository(config: AppConfig, pool?: Pool): NoteRepository {
  if (config.authStore === 'postgres') {
    if (!pool) throw new Error('authStore=postgres requires a database pool');
    return new PgNoteRepository(pool);
  }
  return new InMemoryNoteRepository();
}

/** Blob storage for audio + images (filesystem locally, S3 in prod). */
export function createStorage(config: AppConfig): Storage {
  return new FsStorage(config.storageDir);
}

/** Speech-to-text: stub locally, Groq/Whisper when configured. */
export function createTranscriber(config: AppConfig): Transcriber {
  if (config.transcriberProvider === 'groq') {
    return new GroqTranscriber({
      apiKey: config.groqApiKey ?? '',
      baseUrl: config.groqBaseUrl,
      model: config.groqModel,
    });
  }
  return new StubTranscriber();
}

export function createTranscriptionService(
  config: AppConfig,
  notes: NoteRepository,
  storage: Storage,
): TranscriptionService {
  return new TranscriptionService(createTranscriber(config), notes, storage);
}

/** The extracted spine store (promises), RLS-backed on pg. */
export function createFactsRepository(config: AppConfig, pool?: Pool): FactsRepository {
  if (config.authStore === 'postgres') {
    if (!pool) throw new Error('authStore=postgres requires a database pool');
    return new PgFactsRepository(pool);
  }
  return new InMemoryFactsRepository();
}

/** Text embeddings (stub locally, Bedrock in prod). */
export function createEmbedder(): Embedder {
  return new StubEmbedder(1024);
}

export function createExtractionService(
  config: AppConfig,
  clients: ClientRepository,
  notes: NoteRepository,
  facts: FactsRepository,
): ExtractionService {
  return new ExtractionService(createModelClient(config), clients, notes, facts, createEmbedder());
}
