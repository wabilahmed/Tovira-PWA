/**
 * Recover a JSON object from a model's text response.
 *
 * Real models (Haiku, Sonnet) frequently wrap their JSON in ```json ... ```
 * fences or add a sentence of prose, despite instructions not to. A naive
 * `JSON.parse` throws on those and we would silently drop a perfectly good
 * extraction. This finds the first *balanced* `{...}` object — respecting string
 * literals so a brace inside a value is not mistaken for the end — and parses it.
 *
 * Trust rule: if we cannot produce VALID JSON we return null (a missing fact),
 * never a partial or repaired guess. A wrong fact is worse than a missing one.
 */
export function extractJsonObject(text: string): unknown | null {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (trimmed === '') return null;

  // Fast path: already clean JSON.
  try {
    return JSON.parse(trimmed);
  } catch {
    /* fall through to a balanced scan */
  }

  const start = trimmed.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(trimmed.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null; // unterminated object
}
