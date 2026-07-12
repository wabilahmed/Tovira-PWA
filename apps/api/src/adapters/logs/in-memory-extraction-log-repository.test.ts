import { describe, it, expect } from 'vitest';
import { InMemoryExtractionLogRepository } from './in-memory-extraction-log-repository.js';

const entry = {
  noteId: 'n1',
  promptVersion: 'tovira-extract-v0.1',
  model: 'stub',
  input: 'TODAY... NOTE...',
  rawOutput: '{}',
  status: 'extracted',
  inputTokens: 10,
  outputTokens: 5,
  latencyMs: 42,
};

describe('InMemoryExtractionLogRepository', () => {
  it('records a log row for a user', async () => {
    const repo = new InMemoryExtractionLogRepository();
    await repo.log('user-A', entry);
    const rows = await repo.listByUser('user-A');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.model).toBe('stub');
  });

  // NEGATIVE: the log is PII — it must not be readable across tenants.
  it('does not surface another tenant\'s log rows', async () => {
    const repo = new InMemoryExtractionLogRepository();
    await repo.log('user-A', entry);
    expect(await repo.listByUser('user-B')).toEqual([]);
  });
});
