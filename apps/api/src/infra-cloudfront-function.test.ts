import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * [P30] The frontend distribution's viewer-request CloudFront Function (infra/terraform/functions/
 * frontend-viewer-request.js), run here as plain JS: www.tovira.io → 301 https://tovira.io keeping path and
 * query; tovira.io and staging.tovira.io are served (directory-index + app-shell routing unchanged).
 */
const src = readFileSync(fileURLToPath(new URL('../../../infra/terraform/functions/frontend-viewer-request.js', import.meta.url)), 'utf8');
type Req = { uri: string; headers: Record<string, { value: string }>; querystring: Record<string, { value: string; multiValue?: Array<{ value: string }> }> };
const handler = new Function(`${src}; return handler;`)() as (e: { request: Req }) => Req | { statusCode: number; headers: { location: { value: string } } };
const run = (host: string, uri: string, querystring: Req['querystring'] = {}) => handler({ request: { uri, headers: { host: { value: host } }, querystring } });

describe('[P30] CloudFront viewer-request function', () => {
  it('www.tovira.io → 301 to https://tovira.io, same path', () => {
    expect(run('www.tovira.io', '/privacy')).toEqual({ statusCode: 301, statusDescription: 'Moved Permanently', headers: { location: { value: 'https://tovira.io/privacy' } } });
    expect(run('WWW.tovira.io', '/')).toMatchObject({ statusCode: 301, headers: { location: { value: 'https://tovira.io/' } } });
  });
  it('the query string is preserved (incl. repeated keys and bare flags)', () => {
    const r = run('www.tovira.io', '/invite', { token: { value: 'abc123' }, a: { value: '1', multiValue: [{ value: '1' }, { value: '2' }] }, flag: { value: '' } });
    expect(r).toMatchObject({ statusCode: 301, headers: { location: { value: 'https://tovira.io/invite?token=abc123&a=1&a=2&flag' } } });
  });
  it('tovira.io and staging.tovira.io are served, never redirected', () => {
    for (const host of ['tovira.io', 'staging.tovira.io']) {
      expect(run(host, '/')).toMatchObject({ uri: '/index.html' });
      expect(run(host, '/privacy/')).toMatchObject({ uri: '/privacy/index.html' });
      expect(run(host, '/invite')).toMatchObject({ uri: '/app.html' });
      expect(run(host, '/assets/app.js')).toMatchObject({ uri: '/assets/app.js' });
    }
  });
  // [P89 · owner, Prompt 86] the game's pages are prerendered: their clean addresses map to their index.html (a 200
  // from S3), and an unknown /game/… address is still the app shell (its 404), never a page that doesn't exist
  it('the seven game pages map to their index.html; anything else under /game is the app shell', () => {
    for (const p of ['/game', '/game/property', '/game/insurance', '/game/wealth', '/game/b2b', '/game/luxury', '/game/recruitment']) {
      expect(run('tovira.io', p)).toMatchObject({ uri: `${p}/index.html` });
      expect(run('tovira.io', `${p}/`)).toMatchObject({ uri: `${p}/index.html` });
    }
    expect(run('tovira.io', '/game/unknown')).toMatchObject({ uri: '/app.html' });
    expect(run('tovira.io', '/game/property/index.html')).toMatchObject({ uri: '/game/property/index.html' });
  });
});
