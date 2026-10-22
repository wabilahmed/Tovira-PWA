// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * [P39-7] Guard: no rep-facing screen calls a model to answer a question. The free-text Ask (POST /recall) and its
 * voice input are gone; Find answers fixed questions from stored data. So: no web code calls /recall or uses the
 * browser's speech recognition, and the API has no /recall route.
 */
const ROOT = resolve(process.cwd());
function files(dir: string, ext: RegExp): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p, ext) : ext.test(f) && !/\.test\./.test(f) ? [p] : [];
  });
}
const code = (p: string) => readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('[P39-7] no model answers a rep\'s question', () => {
  it('the web app never calls /recall and has no speech-recognition input', () => {
    const web = files(join(ROOT, 'apps/web/src'), /\.tsx?$/);
    expect(web.filter((f) => /['"`/]recall\b/.test(code(f)) && /fetch\(/.test(code(f)) && /\/recall/.test(code(f))).map((f) => relative(ROOT, f))).toEqual([]);
    expect(web.filter((f) => /SpeechRecognition/.test(code(f))).map((f) => relative(ROOT, f))).toEqual([]);
  });

  it('the API serves no /recall route', () => {
    const http = files(join(ROOT, 'apps/api/src/http'), /\.ts$/);
    expect(http.filter((f) => /path === ['"]\/recall['"]/.test(code(f))).map((f) => relative(ROOT, f))).toEqual([]);
  });

  it('Find calls no model client', () => {
    const find = code(join(ROOT, 'apps/api/src/services/find/find-service.ts'));
    expect(find).not.toMatch(/ModelClient|\.complete\(|embed/i);
  });
});
