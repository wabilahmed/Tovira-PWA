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
