import { describe, it, expect } from 'vitest';
import { createServices, createModelClient } from './container.js';
import { loadConfig } from './config.js';
import { StubModelClient } from './adapters/model/stub.js';
import { AnthropicModelClient } from './adapters/model/anthropic.js';
import { MeteredModelClient } from './adapters/model/metered.js';
import { GatedModelClient } from './adapters/spend/gated-ai-clients.js';
import { StubAuthProvider } from './adapters/auth/stub.js';
import { FsStorage } from './adapters/storage/fs.js';
import { LocalScheduler } from './adapters/scheduler/local.js';

// [P0-2] The composition root selects an implementation for every port from
// config alone — switching a provider needs no change to business logic.
describe('container (composition root)', () => {
  it('wires local implementations for all four ports by default', () => {
    const services = createServices(loadConfig({ DATABASE_URL: 'x' }));
    // [USAGE-ALLOWANCE] Every model client is GATED (outermost) over METERED (CACHE-1) over the provider.
    expect(services.model).toBeInstanceOf(GatedModelClient);
    const metered = (services.model as GatedModelClient).inner;
    expect(metered).toBeInstanceOf(MeteredModelClient);
    expect((metered as MeteredModelClient).inner).toBeInstanceOf(StubModelClient);
    expect(services.auth).toBeInstanceOf(StubAuthProvider);
    expect(services.storage).toBeInstanceOf(FsStorage);
    expect(services.scheduler).toBeInstanceOf(LocalScheduler);
  });

  it('selects the stub model provider by default (keyless local boot)', () => {
    const model = createModelClient(loadConfig({ DATABASE_URL: 'x' }));
    const metered = (model as GatedModelClient).inner as MeteredModelClient;
    expect(metered.inner).toBeInstanceOf(StubModelClient);
  });

  it('switches to the Anthropic HTTP client via config only', () => {
    const model = createModelClient(
      loadConfig({ DATABASE_URL: 'x', MODEL_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'sk-test' }),
    );
    const metered = (model as GatedModelClient).inner as MeteredModelClient;
    expect(metered.inner).toBeInstanceOf(AnthropicModelClient);
  });

  // [TASK ROUTING] Per-class model routing through the composition root.
  it('routes each task class to its configured model', () => {
    const config = loadConfig({ DATABASE_URL: 'x', MODEL_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'sk-test' });
    expect((createModelClient(config, 'extraction') as AnthropicModelClient).modelId).toBe('claude-sonnet-5');
    expect((createModelClient(config, 'recall') as AnthropicModelClient).modelId).toBe('claude-haiku-4-5-20251001');
    // No class given → the extraction default (backward compatible).
    expect((createModelClient(config) as AnthropicModelClient).modelId).toBe('claude-sonnet-5');
  });
});
