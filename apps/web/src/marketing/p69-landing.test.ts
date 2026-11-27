import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * [P69 · owner] Tovira's promise is "helps you close", not "a memory": it picks out what each client cares about and
 * puts it in front of you when it matters. Memory (promises, dates) is the supporting line. Reads the REAL shipped
 * landing HTML.
 * [P89 · owner, Prompt 86] The page is now the owner's Marker page, word for word. The promise is the same ("Walk into
 * every meeting knowing what matters to them."); the P69 rules below are re-pointed to it. One rule moves with the
 * owner's words: P69's "analyses, never reads your chats" gives way to the owner's own "Tovira reads your client chats";
 * what stays is that no line says Tovira reads anything it was not given ("It only sees the chats you give it").
 */
const html = readFileSync(resolve(process.cwd(), 'apps/web/index.html'), 'utf8');
const d = new DOMParser().parseFromString(html, 'text/html');
const text = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const DESC = 'Tovira reads your client chats and catches the details that close deals.';

describe('[P69→P89] the hero', () => {
  it('headline and subhead (the owner\'s Marker wording of the P69 promise)', () => {
    expect(html).not.toContain('FOR RELATIONSHIP SALES');
    expect(text(d.querySelector('h1'))).toBe('Walk into every meeting knowing what matters to them.');
    expect(text(d.querySelector('h1 + p'))).toBe(DESC);
  });
  it('the example shows what the client said and what Tovira caught, kept with the message it came from', () => {
    expect(text(d.getElementById('big'))).toBe("Honestly we're at the beach every weekend.");
    expect(text(d.querySelector('#b4 .card strong'))).toBe('Loves the beach. Every weekend.');
    expect(text(d.querySelector('#b4 .cap'))).toBe('And keeps it, with the message it came from.');
  });
});

describe('[P69→P89] what Tovira does, in order (the three steps)', () => {
  it('export a chat, Tovira reads the chat, your brief is ready before the meeting', () => {
    const steps = [...d.querySelectorAll('#how .t2-in > div > div')].map((s) => [...s.children].map(text));
    expect(steps).toEqual([
      ['1', 'Export a chat', 'Or record a voice note.'],
      ['2', 'Tovira reads the chat', 'Months of history, in minutes.'],
      ['3', 'Your brief is ready before the meeting', 'Open it and walk in prepared.'],
    ]);
  });
});

describe('[P69] no caught line advises, and no invented results', () => {
  it('NEGATIVE: nothing shown as caught advises what to sell or show; no invented results', () => {
    const caught = [...d.querySelectorAll('.card strong, .brief li')].map(text).join(' ');
    expect(caught).not.toMatch(/\b(show (them|her|him)|offer|pitch|sell|recommend|suggest)\b/i);
    expect(html).not.toMatch(/\d+\s?% (more|faster|higher)|close \d+/i);
  });
});

describe('[P69] meta and share text', () => {
  it.each(['meta[name="description"]', 'meta[property="og:description"]', 'meta[name="twitter:description"]'])('%s', (sel) => {
    expect(d.querySelector(sel)?.getAttribute('content')).toBe(DESC);
  });
});

describe('[P69] memory is the supporting line, never the headline', () => {
  it('NEGATIVE: no title, headline or share text leads with memory', () => {
    const leads = [d.title, text(d.querySelector('h1')), ...['og:title', 'twitter:title'].map((p) => d.querySelector(`meta[property="${p}"], meta[name="${p}"]`)?.getAttribute('content') ?? '')];
    for (const l of leads) expect(l).not.toMatch(/memory|remember/i);
    expect(html).not.toMatch(/memory for sales people/i);
  });
  it('NEGATIVE: no line says Tovira reads what it was not given (it only sees the chats you give it)', () => {
    expect(html).toContain('It only sees the chats you give it.');
    expect(html).not.toMatch(/reads (all|every one of) your (chats|messages)|reading your WhatsApp|access to your WhatsApp/i);
  });
});
