// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * [P36-4 · item 6, owner decision 20 Oct] The client page has no Photos section and no photo upload control. Photos
 * fed nothing else (stored only — no extraction from screenshots); stored photos, their retention and their
 * erasure are untouched — this removes only the UI. Fails if a Photos section or upload comes back.
 */
const SRC = resolve(process.cwd(), 'apps/web/src');
const page = (): string => readFileSync(join(SRC, 'App.tsx'), 'utf8');

describe('[P36-4] no Photos section on the client page', () => {
  it('the client page does not render the Gallery (Photos) or an image upload', () => {
    const code = page();
    expect(code).not.toMatch(/<Gallery\b/);
    expect(code).not.toMatch(/from '\.\/gallery\/Gallery\.js'/);
    expect(code).not.toMatch(/accept="image\//);
    expect(code).not.toMatch(/Add a photo/);
  });
});
