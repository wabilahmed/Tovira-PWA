import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Static import scanner used by the P0-2 architecture test. It exists to enforce
 * the swap-ready-interfaces rule: business logic may depend on PORTS (interfaces)
 * and node builtins only — never a concrete vendor SDK, never a concrete adapter.
 */

export interface SourceFile {
  path: string;
  content: string;
}

export interface Violation {
  path: string;
  specifier: string;
  reason: 'vendor-sdk' | 'concrete-adapter';
}

// Concrete vendor SDKs that must never be imported by business logic.
const VENDOR_PATTERNS: RegExp[] = [
  /^@anthropic-ai(\/|$)/,
  /^@aws-sdk(\/|$)/,
  /^@smithy(\/|$)/,
  /^groq-sdk$/,
  /^stripe$/,
  /^openai$/,
  /^pg$/,
  /^pg-.*/,
  /^ioredis$/,
];

const IMPORT_RE = /\bimport\b[^;]*?\bfrom\s*['"]([^'"]+)['"]/g;
const EXPORT_FROM_RE = /\bexport\b[^;]*?\bfrom\s*['"]([^'"]+)['"]/g;
const REQUIRE_RE = /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g;
const DYNAMIC_IMPORT_RE = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;

function specifiers(content: string): string[] {
  const out: string[] = [];
  for (const re of [IMPORT_RE, EXPORT_FROM_RE, REQUIRE_RE, DYNAMIC_IMPORT_RE]) {
    for (const m of content.matchAll(re)) out.push(m[1]!);
  }
  return out;
}

function isConcreteAdapter(spec: string): boolean {
  // A relative or absolute reference into the adapters layer.
  return /(^|\/)adapters(\/|$)/.test(spec);
}

function isVendor(spec: string): boolean {
  return VENDOR_PATTERNS.some((re) => re.test(spec));
}

/** Pure scan over provided files — unit-testable with in-memory fixtures. */
export function scanForVendorImports(files: SourceFile[]): Violation[] {
  const violations: Violation[] = [];
  for (const file of files) {
    for (const spec of specifiers(file.content)) {
      if (isVendor(spec)) {
        violations.push({ path: file.path, specifier: spec, reason: 'vendor-sdk' });
      } else if (isConcreteAdapter(spec)) {
        violations.push({ path: file.path, specifier: spec, reason: 'concrete-adapter' });
      }
    }
  }
  return violations;
}

/** Recursively read *.ts (excluding *.test.ts) under a directory from disk. */
export function readSourceFiles(dir: string): SourceFile[] {
  const out: SourceFile[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...readSourceFiles(full));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
      out.push({ path: full, content: readFileSync(full, 'utf8') });
    }
  }
  return out;
}
