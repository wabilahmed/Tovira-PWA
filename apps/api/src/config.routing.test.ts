import { describe, it, expect } from 'vitest';
import { loadConfig, AI_TASK_CLASSES } from './config.js';

const base = { DATABASE_URL: 'x' };

// [TASK ROUTING] Hybrid model routing: each AI task class has its own model
// setting, config-overridable per class with NO code change. Extraction stays
// on Sonnet 5 (P1-9 gate lock); every other class defaults to Haiku 4.5.
describe('hybrid model routing config (per AI task class)', () => {
  it('exposes a setting for all seven task classes', () => {
    expect([...AI_TASK_CLASSES].sort()).toEqual([
      'brief',
      'drafts',
      'extraction',
      'patterns',
      'priorities',
      'recall',
      'summaries',
    ]);
  });

  it('defaults extraction to Sonnet 5 (gate-locked, do not change)', () => {
    expect(loadConfig(base).models.extraction).toBe('claude-sonnet-5');
  });

  it('defaults every non-extraction class to Haiku 4.5', () => {
    const { models } = loadConfig(base);
    for (const cls of AI_TASK_CLASSES) {
      if (cls === 'extraction') continue;
      expect(models[cls]).toBe('claude-haiku-4-5-20251001');
    }
  });

  it('ANTHROPIC_MODEL overrides extraction only, never the Haiku classes', () => {
    const { models } = loadConfig({ ...base, ANTHROPIC_MODEL: 'claude-opus-4-8' });
    expect(models.extraction).toBe('claude-opus-4-8');
    expect(models.recall).toBe('claude-haiku-4-5-20251001');
    expect(models.priorities).toBe('claude-haiku-4-5-20251001');
  });

  it('HAIKU_MODEL retargets the non-extraction classes but leaves extraction on Sonnet', () => {
    const { models } = loadConfig({ ...base, HAIKU_MODEL: 'claude-haiku-next' });
    expect(models.extraction).toBe('claude-sonnet-5');
    expect(models.recall).toBe('claude-haiku-next');
    expect(models.drafts).toBe('claude-haiku-next');
  });

  it('a per-class MODEL_<CLASS> override switches ONE class with no code change', () => {
    const { models } = loadConfig({ ...base, MODEL_RECALL: 'claude-opus-4-8', MODEL_DRAFTS: 'some-other-model' });
    expect(models.recall).toBe('claude-opus-4-8');
    expect(models.drafts).toBe('some-other-model');
    // Untouched classes keep their family default.
    expect(models.priorities).toBe('claude-haiku-4-5-20251001');
    expect(models.extraction).toBe('claude-sonnet-5');
  });

  it('a per-class override beats the class-family default (MODEL_PRIORITIES wins over HAIKU_MODEL)', () => {
    const { models } = loadConfig({ ...base, HAIKU_MODEL: 'h2', MODEL_PRIORITIES: 'p-special' });
    expect(models.priorities).toBe('p-special');
    expect(models.recall).toBe('h2');
  });
});
