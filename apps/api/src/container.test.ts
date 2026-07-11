import { describe, it, expect } from 'vitest';
import { createServices, createModelClient } from './container.js';
import { loadConfig } from './config.js';
import { StubModelClient } from './adapters/model/stub.js';
import { AnthropicModelClient } from './adapters/model/anthropic.js';
import { StubAuthProvider } from './adapters/auth/stub.js';
import { FsStorage } from './adapters/storage/fs.js';
import { LocalScheduler } from './adapters/scheduler/local.js';

// [P0-2] The composition root selects an implementation for every port from
// config alone — switching a provider needs no change to business logic.
describe('container (composition root)', () => {
  it('wires local implementations for all four ports by default', () => {
    const services = createServices(loadConfig({ DATABASE_URL: 'x' }));
    expect(services.model).toBeInstanceOf(StubModelClient);
    expect(services.auth).toBeInstanceOf(StubAuthProvider);
    expect(services.storage).toBeInstanceOf(FsStorage);
    expect(services.scheduler).toBeInstanceOf(LocalScheduler);
  });

  it('selects the stub model provider by default (keyless local boot)', () => {
    const model = createModelClient(loadConfig({ DATABASE_URL: 'x' }));
    expect(model).toBeInstanceOf(StubModelClient);
  });

  it('switches to the Anthropic HTTP client via config only', () => {
    const model = createModelClient(
      loadConfig({ DATABASE_URL: 'x', MODEL_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'sk-test' }),
    );
    expect(model).toBeInstanceOf(AnthropicModelClient);
  });
});
