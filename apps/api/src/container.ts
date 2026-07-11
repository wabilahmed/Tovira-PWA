import type { AppConfig } from './config.js';
import type { ModelClient } from './ports/model.js';
import type { AuthProvider } from './ports/auth.js';
import type { Storage } from './ports/storage.js';
import type { Scheduler } from './ports/scheduler.js';
import { StubModelClient } from './adapters/model/stub.js';
import { AnthropicModelClient } from './adapters/model/anthropic.js';
import { StubAuthProvider } from './adapters/auth/stub.js';
import { FsStorage } from './adapters/storage/fs.js';
import { LocalScheduler } from './adapters/scheduler/local.js';

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
