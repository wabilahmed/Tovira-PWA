import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * [P46-3] Owner: with REFERRALS_ENABLED off, no referral UI or copy renders anywhere. Every app file that carries
 * referral or "free month" wording must be one of the three gated components, and each of them must read the switch.
 * The landing page carries none (it only passes ?ref= through).
 */
const src = fileURLToPath(new URL('..', import.meta.url));
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const GATED = ['share/ShareCard.tsx', 'auth/LoginScreen.tsx', 'access/RequestAccess.tsx'];
// strings a rep could read: quoted literals and JSX text, not comments or identifiers
const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
const COPY = /(['"`>][^'"`<>]*\b(free month|referral|refer a (friend|colleague)|you both get)\b[^'"`<>]*['"`<])/i;

describe('[P46-3] referral copy lives only behind the switch', () => {
  it('only the gated components carry referral wording, and each reads referralsEnabled', () => {
    const offenders: string[] = [];
    for (const f of walk(src)) {
      if (!/\.tsx?$/.test(f) || /\.test\.|\.guard\./.test(f) || f.includes('/marketing/')) continue;
      const rel = f.slice(src.length).replace(/^\//, '');
      const body = strip(readFileSync(f, 'utf8'));
      if (!COPY.test(body)) continue;
      if (!GATED.includes(rel)) offenders.push(rel);
      else expect(body, rel).toMatch(/referralsEnabled/);
    }
    expect(offenders).toEqual([]);
  });

  it('NEGATIVE: the landing page has no referral or "free month" copy', () => {
    const html = readFileSync(join(src, '..', 'index.html'), 'utf8');
    expect(html).not.toMatch(/free month|referral|you both get/i);
  });
});
