import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { scanForVendorImports, readSourceFiles } from './lib/scan-imports.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const businessLogicDir = resolve(root, 'apps/api/src/services');

// [P0-2] Swap-ready interfaces. Business logic must depend on the interface
// (port), never a concrete vendor SDK or a concrete adapter — so switching an
// implementation is a config change, not a code rewrite.
describe('architecture: business logic imports interfaces, not vendors', () => {
  // The scanner itself must actually catch a violation (otherwise the guard is
  // theatre). NEGATIVE: a direct vendor SDK import is flagged.
  it('flags a direct vendor SDK import', () => {
    const violations = scanForVendorImports([
      { path: 'services/extraction.ts', content: `import Anthropic from '@anthropic-ai/sdk';` },
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.reason).toBe('vendor-sdk');
  });

  it('flags business logic reaching into a concrete adapter', () => {
    const violations = scanForVendorImports([
      { path: 'services/extraction.ts', content: `import { StubModelClient } from '../adapters/model/stub.js';` },
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.reason).toBe('concrete-adapter');
  });

  it('allows importing a port (interface)', () => {
    const violations = scanForVendorImports([
      { path: 'services/extraction.ts', content: `import type { ModelClient } from '../ports/model.js';` },
    ]);
    expect(violations).toEqual([]);
  });

  it('catches require() and dynamic import(), not just static import', () => {
    const violations = scanForVendorImports([
      { path: 'a.ts', content: `const x = require('stripe');` },
      { path: 'b.ts', content: `const y = await import('@aws-sdk/client-s3');` },
    ]);
    expect(violations).toHaveLength(2);
  });

  // POSITIVE (run against the real tree): the actual business-logic layer is clean.
  it('the real services/ layer has zero vendor or adapter imports', () => {
    expect(existsSync(businessLogicDir), 'apps/api/src/services must exist').toBe(true);
    const files = readSourceFiles(businessLogicDir);
    expect(files.length, 'there should be business logic to check').toBeGreaterThan(0);
    const violations = scanForVendorImports(files);
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });
});
