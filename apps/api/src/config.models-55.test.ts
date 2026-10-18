import { describe, it, expect } from 'vitest';
import { loadConfig, AI_TASK_CLASSES } from './config.js';

/** [P23-A2] The two model families are set with MODEL_EXTRACT and MODEL_AUX (no code change to switch),
 *  and effort is explicit. Defaults are UNCHANGED until a model passes the A4 gates. */
const base = { DATABASE_URL: 'x' };

describe('[P23-A2] MODEL_EXTRACT / MODEL_AUX', () => {
  it('defaults are today\'s models (no switch without passing the gates)', () => {
    const c = loadConfig(base);
    expect(c.models.extraction).toBe('claude-sonnet-5');
    expect(c.anthropicModel).toBe('claude-sonnet-5');
    for (const cls of AI_TASK_CLASSES) if (cls !== 'extraction') expect(c.models[cls]).toBe('claude-haiku-4-5-20251001');
  });
  it('MODEL_EXTRACT sets extraction (and the router\'s production model); MODEL_AUX sets every other class', () => {
    const c = loadConfig({ ...base, MODEL_EXTRACT: 'claude-sonnet-5-5', MODEL_AUX: 'claude-haiku-5-5' });
    expect(c.models.extraction).toBe('claude-sonnet-5-5');
    expect(c.anthropicModel).toBe('claude-sonnet-5-5');
    for (const cls of AI_TASK_CLASSES) if (cls !== 'extraction') expect(c.models[cls]).toBe('claude-haiku-5-5');
  });
  it('MODEL_EXTRACT / MODEL_AUX beat the older ANTHROPIC_MODEL / HAIKU_MODEL; a per-class MODEL_<CLASS> still wins', () => {
    const c = loadConfig({ ...base, ANTHROPIC_MODEL: 'old-s', HAIKU_MODEL: 'old-h', MODEL_EXTRACT: 'new-s', MODEL_AUX: 'new-h', MODEL_RECALL: 'special' });
    expect(c.models.extraction).toBe('new-s');
    expect(c.models.priorities).toBe('new-h');
    expect(c.models.recall).toBe('special');
  });
});

describe('[P23-A2] explicit effort', () => {
  it('defaults: extraction low, aux low; aux thinking disabled on models that allow it', () => {
    const c = loadConfig(base);
    expect(c.effortExtract).toBe('low');
    expect(c.effortAux).toBe('low');
    expect(c.auxThinking).toBe('disabled');
  });
  it('EFFORT_EXTRACT / EFFORT_AUX / AUX_THINKING are validated', () => {
    expect(loadConfig({ ...base, EFFORT_EXTRACT: 'medium', EFFORT_AUX: 'high', AUX_THINKING: 'adaptive' })).toMatchObject({ effortExtract: 'medium', effortAux: 'high', auxThinking: 'adaptive' });
    expect(() => loadConfig({ ...base, EFFORT_EXTRACT: 'adaptive' })).toThrow(/EFFORT_EXTRACT/);
    expect(() => loadConfig({ ...base, AUX_THINKING: 'enabled' })).toThrow(/AUX_THINKING/);
  });
});
