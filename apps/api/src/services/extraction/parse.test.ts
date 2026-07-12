import { describe, it, expect } from 'vitest';
import { extractJsonObject } from './parse.js';

describe('extractJsonObject', () => {
  // Positive: the model may format its JSON several ways — we must recover the object.
  it('parses a clean JSON object', () => {
    expect(extractJsonObject('{"a":1,"b":"x"}')).toEqual({ a: 1, b: 'x' });
  });

  it('parses JSON wrapped in a ```json fenced block (real Haiku/Sonnet behaviour)', () => {
    const fenced = '```json\n{\n  "summary": "hi",\n  "promises": []\n}\n```';
    expect(extractJsonObject(fenced)).toEqual({ summary: 'hi', promises: [] });
  });

  it('parses JSON wrapped in a bare ``` fenced block (no language tag)', () => {
    expect(extractJsonObject('```\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('extracts the object when the model adds prose before and after', () => {
    const noisy = 'Sure, here is the extraction:\n{"a":1}\nLet me know if you need more.';
    expect(extractJsonObject(noisy)).toEqual({ a: 1 });
  });

  it('handles braces that appear inside string values', () => {
    expect(extractJsonObject('{"text":"use {curly} braces } here"}')).toEqual({
      text: 'use {curly} braces } here',
    });
  });

  it('tolerates leading/trailing whitespace', () => {
    expect(extractJsonObject('  \n {"a":1} \n ')).toEqual({ a: 1 });
  });

  // Negative: when we cannot get VALID JSON, we must return null (a missing fact),
  // never a fabricated or partial guess. These encode the product's trust rule.
  it('returns null for text with no JSON object', () => {
    expect(extractJsonObject('I could not extract anything.')).toBeNull();
  });

  it('returns null for a fenced block containing broken JSON', () => {
    expect(extractJsonObject('```json\n{"a": }\n```')).toBeNull();
  });

  it('returns null for an unterminated object', () => {
    expect(extractJsonObject('{"a":1, "b":')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(extractJsonObject('')).toBeNull();
  });

  it('does not confuse a brace inside a string with the object end', () => {
    // The first "}" is inside the string; the real object end is later.
    expect(extractJsonObject('{"a":"}","b":2}')).toEqual({ a: '}', b: 2 });
  });
});
