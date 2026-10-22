// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * [P39] The design system holds: in app CSS, spacing comes only from the spacing scale, font sizes only from
 * the type scale, and colours only from semantic tokens. Token DEFINITIONS (custom properties in system.css)
 * are where raw values live; everything else must reference them.
 */
const STYLES = resolve(process.cwd(), 'apps/web/src');
/** The stylesheets under the guard: every app stylesheet. (marketing/ is the landing page, which keeps its own look.) */
export const GUARDED = ['styles/system.css', 'styles/components.css', 'styles/theme.css', 'auth/auth.css'];

const SPACING_PROPS = /^(margin|margin-(top|right|bottom|left|inline|block|inline-start|inline-end|block-start|block-end)|padding|padding-(top|right|bottom|left|inline|block|inline-start|inline-end|block-start|block-end)|gap|row-gap|column-gap|scroll-padding-inline)$/;
const COLOR_PROPS = /^(color|background|background-color|border|border-(top|right|bottom|left)|border-color|outline|outline-color|fill|stroke|box-shadow|text-decoration-color|caret-color)$/;
const SPACE_VAR = /var\(--(space-[1-7]|gutter|section-gap|stack-gap|touch)\)/g;

function declarations(css: string): Array<{ prop: string; value: string; line: number }> {
  const out: Array<{ prop: string; value: string; line: number }> = [];
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  const re = /([a-z-]+)\s*:\s*([^;{}]+);/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean))) out.push({ prop: m[1]!, value: m[2]!.trim(), line: clean.slice(0, m.index).split('\n').length });
  return out;
}

/** A spacing value is fine when, with the allowed variables removed, nothing with a unit is left. */
export function badSpacing(value: string): boolean {
  const rest = value.replace(SPACE_VAR, '').replace(/calc\(|\)|[-+*/]|\b(auto|0|inherit|none)\b|\d+(\.\d+)?%|\b\d+(\.\d+)?\b(?![a-z%])/g, ' ');
  return /\d/.test(rest) || /var\(/.test(rest);
}
export function badFontSize(value: string): boolean {
  return !/^(var\(--text-(title|section|body|secondary|label|caption)-size\)|inherit)$/.test(value);
}
export function badColor(value: string): boolean {
  return /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|\b(white|black|red|blue|green|gray|grey)\b/i.test(value.replace(/var\(--[a-z0-9-]+\)/g, ''));
}

describe('[P39] app CSS uses the design tokens only', () => {
  for (const file of GUARDED) {
    it(`${file}: spacing, font sizes and colours come from tokens`, () => {
      const offenders: string[] = [];
      for (const d of declarations(readFileSync(resolve(STYLES, file), 'utf8'))) {
        if (d.prop.startsWith('--')) continue; // token definitions are where raw values live
        if (SPACING_PROPS.test(d.prop) && badSpacing(d.value)) offenders.push(`${file}:${d.line} ${d.prop}: ${d.value}`);
        if (d.prop === 'font-size' && badFontSize(d.value)) offenders.push(`${file}:${d.line} ${d.prop}: ${d.value}`);
        if (COLOR_PROPS.test(d.prop) && badColor(d.value)) offenders.push(`${file}:${d.line} ${d.prop}: ${d.value}`);
      }
      expect(offenders).toEqual([]);
    });
  }

  // [P39-8] Inline styles in the app's components follow the same rules (the landing page keeps its own look).
  it('inline styles in app components: spacing, font sizes and colours come from tokens', () => {
    const tsx = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? (f === 'marketing' ? [] : tsx(p)) : /\.tsx$/.test(f) && !/\.test\./.test(f) ? [p] : [];
    });
    const offenders: string[] = [];
    for (const f of tsx(STYLES)) {
      const src = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      for (const m of src.matchAll(/\b(margin\w*|padding\w*|gap|rowGap|columnGap)\s*:\s*(['"])([^'"]*)\2/g)) if (badSpacing(m[3]!)) offenders.push(`${relative(STYLES, f)} ${m[1]}: ${m[3]}`);
      for (const m of src.matchAll(/\b(margin\w*|padding\w*|gap|rowGap|columnGap)\s*:\s*(-?[1-9]\d*(?:\.\d+)?)\s*[,}]/g)) offenders.push(`${relative(STYLES, f)} ${m[1]}: ${m[2]}`);
      for (const m of src.matchAll(/\bfontSize\s*:\s*(['"]?)([^'",}]*)\1/g)) if (badFontSize(m[2]!.trim())) offenders.push(`${relative(STYLES, f)} fontSize: ${m[2]}`);
      for (const m of src.matchAll(/\b(color|background|backgroundColor|border\w*|boxShadow|outline)\s*:\s*(['"])([^'"]*)\2/g)) if (badColor(m[3]!)) offenders.push(`${relative(STYLES, f)} ${m[1]}: ${m[3]}`);
    }
    expect(offenders).toEqual([]);
  });

  // [P39-11] A select is never the browser's default look: every <select> carries .ui-native-select.
  it('every native <select> is styled', () => {
    const tsx = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? (f === 'marketing' ? [] : tsx(p)) : /\.tsx$/.test(f) && !/\.test\./.test(f) ? [p] : [];
    });
    const bare = tsx(STYLES).flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/<select\b[^>]*>/g)].filter((m) => !/ui-native-select/.test(m[0])).map(() => relative(STYLES, f)));
    expect(bare).toEqual([]);
  });

  it('the guard catches off-scale values', () => {
    expect(badSpacing('10px')).toBe(true);
    expect(badSpacing('0.6rem 1rem')).toBe(true);
    expect(badSpacing('var(--space-3) var(--gutter)')).toBe(false);
    expect(badSpacing('calc(-1 * var(--gutter))')).toBe(false);
    expect(badSpacing('0 auto')).toBe(false);
    expect(badFontSize('0.72rem')).toBe(true);
    expect(badFontSize('var(--text-body-size)')).toBe(false);
    expect(badColor('#d14821')).toBe(true);
    expect(badColor('rgba(0,0,0,.4)')).toBe(true);
    expect(badColor('1px solid var(--color-border)')).toBe(false);
  });
});
