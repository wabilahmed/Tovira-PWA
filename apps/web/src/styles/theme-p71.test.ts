// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getTheme, initTheme, setTheme, applyTheme } from './theme.js';

/**
 * [P71-D · owner] Dark mode everywhere uses the landing palette, mapped onto the existing tokens: page #171412, deeper
 * areas #120F0D (the "sunken" token), cards #1F1B18, borders #332D28, text #F2EDE4 / #CFC6BA / #A79E92, accent #E8643A
 * (hover #F28A63, text on it #171412), highlight fill rgba(232,100,58,0.16). Light mode stays exactly as it was. Anyone
 * who never chose a theme now gets Dark; a stored Light, Dark or Auto is kept. Status colours stay readable on #171412
 * and differ from each other (and from the accent) in lightness, not just hue. Form fields get a border that clears 3:1.
 * The browser's theme-color follows the theme in use (#171412 dark).
 */
const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const css = read('../../../../packages/brand/tokens.css');
function block(selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  const open = css.indexOf('{', start + selector.length - 1);
  const body = css.slice(open + 1, css.indexOf('}', open));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--[\w-]+):\s*([^;]+);/g)) out[m[1]!] = m[2]!.trim();
  return out;
}
const lin = (c: number): number => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const lum = (hex: string): number => { const n = parseInt(hex.slice(1), 16); return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255); };
const ratio = (a: string, b: string): number => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const lstar = (hex: string): number => 116 * Math.cbrt(lum(hex)) - 16;

const DARK = {
  '--surface-base': '#171412', '--surface-raised': '#1F1B18', '--surface-elevated': '#120F0D', '--hairline': '#332D28',
  '--text-primary': '#F2EDE4', '--text-secondary': '#CFC6BA', '--text-tertiary': '#A79E92',
  '--brass': '#E8643A', '--brass-strong': '#F28A63', '--brass-ink': '#171412', '--brass-surface': 'rgba(232, 100, 58, 0.16)',
};
// Light mode exactly as it was before P71 (copied from the shipped tokens).
const LIGHT = {
  '--surface-base': '#f4f1ea', '--surface-raised': '#faf7ef', '--surface-elevated': '#ede8dc', '--hairline': '#d6cfbd',
  '--text-primary': '#1c1917', '--text-secondary': '#6b645d', '--text-tertiary': '#8b847a', '--brass': '#d14821',
  '--brass-strong': '#c0411d', '--brass-ink': '#ffffff', '--brass-surface': 'rgba(209, 72, 33, 0.12)', '--claret': '#9e3b33',
  '--claret-line': '#c99b96', '--claret-surface': 'rgba(158, 59, 51, 0.10)', '--green': '#4a7c59', '--green-line': '#a9bbaf',
  '--green-surface': 'rgba(74, 124, 89, 0.10)', '--amber': '#96661f', '--amber-line': '#d6c08a', '--amber-surface': 'rgba(252, 211, 77, 0.22)',
};
const dark = [block(":root:not([data-theme='ledger']) {"), block(":root[data-theme='vault'] {")];
const light = [block(':root {'), block(":root[data-theme='ledger'] {")];

describe('[P71-D] the dark palette', () => {
  it('both dark blocks (Auto on a dark device, and Dark) carry the landing palette', () => {
    for (const t of dark) for (const [k, v] of Object.entries(DARK)) expect(t[k]?.toUpperCase(), k).toBe(v.toUpperCase());
    expect(dark[0]).toEqual(dark[1]);
  });
  it('light mode is exactly as it was', () => {
    for (const t of light) for (const [k, v] of Object.entries(LIGHT)) expect(t[k], k).toBe(v);
    for (const t of light) expect(t['--hairline-control'], 'a light field border is unchanged').toBe('#d6cfbd');
  });
  it('every dark text colour clears 4.5:1 on the page, cards and deeper areas', () => {
    const t = dark[1]!;
    for (const fg of ['--text-primary', '--text-secondary', '--text-tertiary', '--brass', '--brass-strong', '--claret', '--green', '--amber']) {
      for (const bg of ['--surface-base', '--surface-raised', '--surface-elevated']) expect(ratio(t[fg]!, t[bg]!), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
    expect(ratio(t['--brass-ink']!, t['--brass']!)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(t['--brass-ink']!, t['--brass-strong']!)).toBeGreaterThanOrEqual(4.5);
  });
  it('a form field\'s border clears 3:1 on every surface (the plain border is decorative only)', () => {
    const t = dark[1]!;
    for (const bg of ['--surface-base', '--surface-raised', '--surface-elevated']) expect(ratio(t['--hairline-control']!, t[bg]!), bg).toBeGreaterThanOrEqual(3);
    const comp = read('./components.css');
    expect(comp).toMatch(/--color-border-control/);
    expect(read('../auth/auth.css')).toMatch(/\.auth__field input \{[^}]*border: 1px solid var\(--hairline-control\)/);
  });
  it('overdue red, success green and warning amber differ from each other and from the accent in lightness', () => {
    const t = dark[1]!;
    const ls = ['--brass', '--claret', '--green', '--amber'].map((k) => lstar(t[k]!));
    for (let i = 0; i < ls.length; i++) for (let j = i + 1; j < ls.length; j++) expect(Math.abs(ls[i]! - ls[j]!), `${i}/${j}`).toBeGreaterThanOrEqual(4);
    const status = ['--claret', '--green', '--amber'].map((k) => lstar(t[k]!));
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) expect(Math.abs(status[i]! - status[j]!)).toBeGreaterThanOrEqual(8);
    expect(Math.abs(lstar(t['--claret']!) - lstar(t['--brass']!)), 'overdue red is not the accent').toBeGreaterThanOrEqual(8);
  });
});

describe('[P71-D] Dark is the default for anyone who never chose', () => {
  beforeEach(() => { localStorage.clear(); document.documentElement.removeAttribute('data-theme'); document.head.innerHTML = '<meta name="theme-color" content="#f4f1ea">'; });
  it('no stored choice: Dark', () => {
    expect(getTheme()).toBe('vault');
    initTheme();
    expect(document.documentElement.getAttribute('data-theme')).toBe('vault');
  });
  it('a stored Light, Dark or Auto is kept', () => {
    for (const v of ['ledger', 'vault', 'system'] as const) { localStorage.setItem('tovira.theme', v); expect(getTheme()).toBe(v); }
  });
  it('the boot scripts in app.html, Privacy and Terms default to Dark and keep a stored choice', () => {
    for (const p of ['../../app.html', '../../privacy/index.html', '../../terms/index.html']) {
      const src = read(p);
      const script = /<script>([\s\S]*?tovira\.theme[\s\S]*?)<\/script>/.exec(src)?.[1];
      expect(script, p).toBeTruthy();
      for (const [stored, want] of [[null, 'vault'], ['ledger', 'ledger'], ['vault', 'vault'], ['system', null]] as const) {
        localStorage.clear(); document.documentElement.removeAttribute('data-theme');
        if (stored) localStorage.setItem('tovira.theme', stored);
        new Function(script!)();
        expect(document.documentElement.getAttribute('data-theme'), `${p} ${stored}`).toBe(want);
      }
    }
  });
  it('the browser theme-color follows the theme in use: #171412 dark, #f4f1ea light', () => {
    setTheme('vault');
    expect(document.querySelector('meta[name="theme-color"]')!.getAttribute('content')).toBe('#171412');
    setTheme('ledger');
    expect(document.querySelector('meta[name="theme-color"]')!.getAttribute('content')).toBe('#f4f1ea');
    applyTheme('vault');
    expect(document.querySelector('meta[name="theme-color"]')!.getAttribute('content')).toBe('#171412');
  });
  it('the dark theme-color in the HTML is #171412, and the landing page is always dark', () => {
    expect(read('../../app.html')).toMatch(/<meta name="theme-color" content="#171412" media="\(prefers-color-scheme: dark\)" \/>/);
    expect(read('../../app.html')).not.toMatch(/#1b1512/);
    expect(read('../../index.html')).toMatch(/<meta name="theme-color" content="#171412" \/>/);
    expect(read('../../index.html')).not.toMatch(/tovira\.theme/);
  });
  it('the installed app\'s splash and chrome start dark (the default): manifest #171412', async () => {
    const { manifest } = await import('../pwa/manifest.js');
    expect([manifest.background_color, manifest.theme_color]).toEqual(['#171412', '#171412']);
  });
});
