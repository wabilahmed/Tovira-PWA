import { describe, it, expect, vi } from 'vitest';
import { loadConfig } from '../config.js';
import { createModelClient } from '../container.js';
import { AnthropicModelClient } from '../adapters/model/anthropic.js';
import { EXTRACTION_SYSTEM_PROMPT } from './extraction/prompt.js';
import { RecallService } from './recall/recall-service.js';
import { InMemoryExtractionLogRepository } from '../adapters/logs/in-memory-extraction-log-repository.js';
import type { Embedder } from '../ports/embedder.js';
import type { NoteRepository, SimilarNote } from '../ports/note-repository.js';
import type { ModelClient } from '../ports/model.js';

const anthropic = (env: Record<string, string> = {}) =>
  loadConfig({ DATABASE_URL: 'x', MODEL_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'sk-test', ...env });

// [TASK ROUTING] The composition root routes each class to its configured model.
describe('hybrid routing — createModelClient per task class', () => {
  it('routes extraction to Sonnet and the other classes to Haiku', () => {
    const config = anthropic();
    expect((createModelClient(config, 'extraction') as AnthropicModelClient).modelId).toBe('claude-sonnet-5');
    expect((createModelClient(config, 'recall') as AnthropicModelClient).modelId).toBe('claude-haiku-4-5-20251001');
    expect((createModelClient(config, 'priorities') as AnthropicModelClient).modelId).toBe('claude-haiku-4-5-20251001');
    expect((createModelClient(config, 'drafts') as AnthropicModelClient).modelId).toBe('claude-haiku-4-5-20251001');
  });

  it('defaults to the extraction (Sonnet) model when no class is given — backward compatible', () => {
    expect((createModelClient(anthropic()) as AnthropicModelClient).modelId).toBe('claude-sonnet-5');
  });

  it('honours a per-class env override with no code change', () => {
    const config = anthropic({ MODEL_PRIORITIES: 'claude-opus-4-8' });
    expect((createModelClient(config, 'priorities') as AnthropicModelClient).modelId).toBe('claude-opus-4-8');
    // The extraction gate is unaffected.
    expect((createModelClient(config, 'extraction') as AnthropicModelClient).modelId).toBe('claude-sonnet-5');
  });
});

// [TASK ROUTING] Cache correctness: Haiku and Sonnet keep SEPARATE caches (a
// different model id is a different cache). The extraction cacheable prefix must
// stay byte-identical and free of any per-class / variable content.
describe('hybrid routing — prompt-cache correctness', () => {
  it('gives Haiku and Sonnet classes different model ids (separate caches)', () => {
    const config = anthropic();
    const sonnet = (createModelClient(config, 'extraction') as AnthropicModelClient).modelId;
    const haiku = (createModelClient(config, 'recall') as AnthropicModelClient).modelId;
    expect(sonnet).not.toBe(haiku);
  });

  it('keeps the extraction cacheable prefix byte-identical regardless of how other classes are routed', () => {
    const before = EXTRACTION_SYSTEM_PROMPT;
    // Reconfigure every other class — the extraction prefix must not move.
    anthropic({ HAIKU_MODEL: 'x', MODEL_RECALL: 'y', MODEL_PRIORITIES: 'z', MODEL_DRAFTS: 'w' });
    expect(EXTRACTION_SYSTEM_PROMPT).toBe(before);
  });

  it('never injects variable content (date, glossary, or a model id) into the cached prefix', () => {
    expect(EXTRACTION_SYSTEM_PROMPT).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(EXTRACTION_SYSTEM_PROMPT).not.toMatch(/haiku|sonnet|opus/i);
  });
});

// [TASK ROUTING] A non-extraction call must NOT write to the extraction training
// log (that log is P1-8 training data; only ExtractionService may append to it).
describe('hybrid routing — training-log isolation', () => {
  it('a recall answer leaves the extraction training log untouched', async () => {
    const logs = new InMemoryExtractionLogRepository();
    const embedder: Embedder = { dimension: 8, embed: async () => [1, 0, 0, 0, 0, 0, 0, 0] };
    const match: SimilarNote = {
      note: {
        id: 'n1', userId: 'u1', clientId: 'c1', source: 'paste',
        rawText: 'Ahmed said the pricing is too high.', audioKey: null, status: 'extracted',
        extracted: null, messages: null, createdAt: Date.parse('2026-01-16T10:00:00Z'),
      },
      similarity: 0.9,
    };
    const notes = { searchSimilarByUser: vi.fn().mockResolvedValue([match]) } as unknown as NoteRepository;
    const model: ModelClient = { complete: async () => ({ text: 'Ahmed said the pricing is too high.' }) };

    const recall = new RecallService(embedder, notes, model);
    await recall.ask('u1', 'What did Ahmed say about pricing?');

    expect(await logs.listByUser('u1')).toEqual([]);
  });
});
