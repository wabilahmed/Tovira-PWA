import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, normalize, relative } from 'node:path';

/**
 * [P25-2] The "extraction code" part of the fabrication window key: a SHA-256 over every local source file
 * the gate's scoring path loads — the import closure (relative imports, type-only included) of the gate's
 * entry files. Any change to what the gate scores (the certified prompt, parsing, the owner check, redaction,
 * the scorer, the eval set …) changes it and starts a fresh window; a change outside that path does not.
 * Packages (non-relative imports) are excluded: they are pinned by the lockfile.
 */
export const GATE_ENTRY_FILES = ['eval/gate.ts', 'eval/score.ts', 'eval/eval-set.ts'];

const IMPORT_RE = /(?:import|export)\s[^'"]*?from\s*['"](\.{1,2}\/[^'"]+)['"]|import\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g;

/** Every local file reachable from `entries` (paths relative to `srcRoot`), sorted. */
export function importClosure(srcRoot: string, entries: string[]): string[] {
  const seen = new Set<string>();
  const stack = [...entries];
  while (stack.length) {
    const rel = normalize(stack.pop()!).replace(/\\/g, '/');
    if (seen.has(rel)) continue;
    const abs = join(srcRoot, rel);
    if (!existsSync(abs)) continue;
    seen.add(rel);
    const text = readFileSync(abs, 'utf8');
    for (const m of text.matchAll(IMPORT_RE)) {
      const spec = (m[1] ?? m[2])!;
      const target = join(dirname(abs), spec.replace(/\.js$/, '.ts'));
      stack.push(relative(srcRoot, target).replace(/\\/g, '/'));
    }
  }
  return [...seen].sort();
}

/** SHA-256 over (path + NUL + content + NUL) of the closure, in sorted order. */
export function extractionFingerprint(srcRoot: string, entries: string[] = GATE_ENTRY_FILES): string {
  const h = createHash('sha256');
  for (const f of importClosure(srcRoot, entries)) h.update(f).update('\0').update(readFileSync(join(srcRoot, f))).update('\0');
  return h.digest('hex');
}

/** [owner ruling, 18 Oct] The NARROW extraction surface — the window key. A change here starts a fresh window
 *  (the certified prompt, parsing/validation, the owner check, the write-time filters, redaction, the gate and
 *  the scorer). Plumbing (repositories, wiring) is deliberately outside it. */
export const NARROW_SURFACE = [
  'services/extraction/prompt.ts', 'services/extraction/parse.ts', 'services/extraction/validate.ts', 'services/extraction/owner-check.ts',
  'services/extraction/health-filter.ts', 'services/extraction/receipt-postcheck.ts', 'services/extraction/resolve-date.ts',
  'services/redaction/redact.ts', 'eval/gate.ts', 'eval/score.ts', 'eval/eval-set.ts',
];
/** [owner ruling, 18 Oct] The CERTIFICATION surface — a change here (or to the prompt version / model) makes the
 *  next CI gate run the in-job full certification: the certified prompt, the gate code, the scorer, the eval set. */
export const CERT_SURFACE = ['services/extraction/prompt.ts', 'eval/gate.ts', 'eval/score.ts', 'eval/eval-set.ts'];

/** SHA-256 over an explicit file list (path + NUL + content + NUL, sorted). A missing file is an error. */
export function fingerprintFiles(srcRoot: string, files: string[]): string {
  const h = createHash('sha256');
  for (const f of [...files].sort()) h.update(f).update('\0').update(readFileSync(join(srcRoot, f))).update('\0');
  return h.digest('hex');
}
