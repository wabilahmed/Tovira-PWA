// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { bringCardIntoView, STACKED_QUERY } from './game.js';

/**
 * [P76 · owner] Landing page feedback. The hero loses its eyebrow and its headline is smaller (clamp(34px, 4.4vw,
 * 58px)), with the headline's first line lined up with "Would you have caught it?" on desktop (checked in Playwright);
 * the hero's Play the game button shows only when the game is stacked below (mobile). On mobile a new chat, Play again
 * or Try another industry brings the card's top just below the sticky header. The header links scroll smoothly
 * (instant with reduced motion) and land just below the header. "It shows its work" swaps two items and gets the new
 * heading (its "IT SHOWS ITS WORK" label goes: it repeated the heading); the FAQ is the owner's five questions, word for word,
 * except "family moments" is "family occasions" (owner: the P41 rule keeps "moments" off the landing page). The approved design file says the same.
 */
const html = readFileSync(resolve(process.cwd(), 'apps/web/index.html'), 'utf8');
const ref = readFileSync(resolve(process.cwd(), 'plan/tovira-landing-reference.dc.html'), 'utf8');
const d = new DOMParser().parseFromString(html, 'text/html');
const text = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const style = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
const refStyle = ref.slice(ref.indexOf('<style>'), ref.indexOf('</style>'));

const FEATURES = [
  ['Linked to the message', 'Tap any detail to see exactly where the client said it.'],
  ['Never invents a date', 'If "next week sometime" isn\'t clear, it asks you instead of guessing.'],
  ['A brief before every meeting', 'What they care about, what you promised and what\'s due, in one screen before you walk in.'],
  ['Every promise, on time', 'Every date and commitment, yours and theirs, on your list before it\'s due.'],
];
const FAQ: Array<[string, string]> = [
  ['What does Tovira pick up from a chat?', "The things that help you close: what the client loves, what they're looking for and at what price, deadlines, worries, family occasions, and every promise and date, yours and theirs. Every detail is linked to the exact message it came from, so you can check it in one tap."],
  ['How do I get my chats into Tovira?', 'Export a WhatsApp chat and add it in Tovira, record a short voice note after a call or meeting, or just type what you know. Tovira files everything under the right client.'],
  ['What does Tovira do with what it finds?', "It puts it in front of you when it matters. Each client has a page showing what they care about. Before a meeting you get a brief. Each morning, Today shows who to call and why. And you're reminded before any promise is due."],
  ['Does it work in Arabic, Hindi or Urdu?', 'Yes. Chats and voice notes in English, Arabic, Hindi and Urdu all work, even when a client mixes languages in one message.'],
  ['Why not just ask ChatGPT?', "ChatGPT is great at answering what you ask, about what you paste in. But you have to remember to ask, and you have to know what you're looking for. Tovira works the other way round. It reads every chat you give it, picks out what each client cares about, and files it under the right client, linked to the exact message. It never makes up a date it can't find. Then it brings the right detail to you, before the meeting and in your morning list, without you asking. ChatGPT helps when you remember. Tovira is for the details you didn't know you'd forgotten."],
];

describe('[P76] the hero', () => {
  it('NEGATIVE: the "FOR RELATIONSHIP SALES" eyebrow is gone, from the page and the design file', () => {
    expect(html).not.toMatch(/FOR RELATIONSHIP SALES/i);
    expect(ref).not.toMatch(/FOR RELATIONSHIP SALES/i);
  });
  it('the headline is clamp(34px, 4.4vw, 58px), same two lines, same colours', () => {
    const h1 = d.querySelector('h1')!;
    expect(h1.getAttribute('style')).toContain('font-size: clamp(34px, 4.4vw, 58px)');
    expect(html).not.toContain('clamp(40px, 6vw, 78px)');
    expect([...h1.querySelectorAll(':scope > span')].map(text)).toEqual(['The detail that wins the deal is already in your chats.', 'You just scrolled past it.']);
    expect(h1.querySelector('span:last-child')!.getAttribute('style')).toContain('color: #E8643A');
    expect(h1.querySelector('span:first-child')!.getAttribute('style')).not.toContain('color');
    expect(ref).toContain('font-size: clamp(34px, 4.4vw, 58px)');
    expect(ref).not.toContain('clamp(40px, 6vw, 78px)');
  });
  it('the hero\'s Play the game shows only when the game is stacked (hidden from 900px), the header\'s Test your eye stays', () => {
    const play = [...d.querySelectorAll('#top a.tv-cta')].find((a) => text(a) === 'Play the game')!;
    expect(play.classList.contains('tv-mobplay')).toBe(true);
    expect(STACKED_QUERY).toBe('(max-width: 899px)');
    for (const s of [style, refStyle]) {
      expect(s).toMatch(/@media \(min-width: 900px\)\{[^\n]*\.tv-mobplay\{display:none\}/);
      expect(s).toMatch(/@media \(min-width: 900px\)\{[^\n]*\.tv-hero\{flex-wrap:nowrap !important\}/); // side by side exactly when the button hides
    }
    expect(text(d.querySelector('body > header nav a[href="#game"]'))).toBe('Test your eye');
    expect(ref).toMatch(/class="tv-cta tv-mobplay"[^>]*>Play the game</);
  });
});

describe('[P76] header links scroll smoothly and land below the header', () => {
  it('smooth scroll, instant with reduced motion; each target has a scroll margin', () => {
    for (const s of [style, refStyle]) {
      expect(s).toContain('html{scroll-behavior:smooth}');
      expect(s).toMatch(/@media \(prefers-reduced-motion: reduce\)\{html\{scroll-behavior:auto\}/);
      expect(s).toMatch(/#how,#pricing\{scroll-margin-top:\d+px\}/);
    }
    for (const id of ['game', 'how', 'pricing']) expect(d.getElementById(id), id).not.toBeNull();
  });
});

describe('[P76] "It shows its work"', () => {
  const sec = () => d.querySelector('section[aria-labelledby="trust-h"]')!;
  it('the new heading and the four items, word for word', () => {
    expect(text(sec().querySelector('h2'))).toBe('It shows its work, then puts it to work.');
    const items = [...sec().querySelectorAll('div.tv-rv > div:first-child')].map((el) => [text(el), text(el.nextElementSibling)]);
    expect(items).toEqual(FEATURES);
    for (const [h, b] of FEATURES) { expect(ref).toContain(`>${h}</div>`); expect(ref).toContain(b); }
    expect(ref).toContain('It shows its work, then puts it to work.</h2>');
  });
  it('NEGATIVE: the "IT SHOWS ITS WORK" label above the heading is gone (owner: it repeated the heading)', () => {
    expect(html).not.toMatch(/IT SHOWS ITS WORK/);
    expect(ref).not.toMatch(/IT SHOWS ITS WORK/);
    expect(d.getElementById('trust-h')!.previousElementSibling).toBeNull();
  });
  it('NEGATIVE: "Not connected to your WhatsApp" and "Private by design" are gone; the hero line stays', () => {
    for (const src of [html, ref]) {
      expect(src).not.toContain('Not connected to your WhatsApp');
      expect(src).not.toContain('Private by design');
      expect(src).not.toContain('No guesses. Every detail has a receipt.');
      expect(src).toContain('Then AED 299 a month. Tovira never connects to your WhatsApp account.');
    }
  });
});

describe('[P76] the FAQ', () => {
  it('exactly the five questions and answers, word for word, in order', () => {
    const got = [...d.querySelectorAll('details')].map((el) => [text(el.querySelector('summary')), text(el.querySelector('p'))]);
    expect(got).toEqual(FAQ);
    for (const [q, a] of FAQ) { expect(ref).toContain(`>${q}</summary>`); expect(ref).toContain(a); }
  });
  it('NEGATIVE: none of the old questions is left', () => {
    for (const q of ['Is it a CRM?', 'Do I have to connect my WhatsApp?', 'Who is it not for?', 'ChatGPT answers when you ask.']) { expect(html).not.toContain(q); expect(ref).not.toContain(q); }
  });
});

describe('[P76] on mobile, a new chat brings the card into view', () => {
  const fakeWin = (o: { stacked: boolean; reduced?: boolean; headerBottom?: number; cardTop: number; scrollY?: number; innerHeight?: number }) => {
    const scrollTo = vi.fn();
    const header = { getBoundingClientRect: () => ({ bottom: o.headerBottom ?? 60 }) };
    const win = {
      matchMedia: (q: string) => ({ matches: q === STACKED_QUERY ? o.stacked : q === '(prefers-reduced-motion: reduce)' ? !!o.reduced : false }),
      document: { querySelector: (s: string) => (s === 'body > header' ? header : null) },
      scrollY: o.scrollY ?? 1000, innerHeight: o.innerHeight ?? 844, scrollTo,
    } as unknown as Window;
    const card = { getBoundingClientRect: () => ({ top: o.cardTop }) } as unknown as HTMLElement;
    return { win, card, scrollTo };
  };
  it('the card top is above the header: smooth-scrolls it to just below the header', () => {
    const { win, card, scrollTo } = fakeWin({ stacked: true, cardTop: -300 });
    expect(bringCardIntoView(card, win)).toBe(true);
    expect(scrollTo).toHaveBeenCalledWith({ top: 1000 - 300 - 60 - 12, behavior: 'smooth' });
  });
  it('the card top is under the sticky header (partly hidden): scrolls too', () => {
    const { win, card, scrollTo } = fakeWin({ stacked: true, cardTop: 30 });
    expect(bringCardIntoView(card, win)).toBe(true);
    expect(scrollTo).toHaveBeenCalledWith({ top: 1000 + 30 - 72, behavior: 'smooth' });
  });
  it('the card top is below the screen: scrolls up to it', () => {
    const { win, card, scrollTo } = fakeWin({ stacked: true, cardTop: 900 });
    expect(bringCardIntoView(card, win)).toBe(true);
    expect(scrollTo).toHaveBeenCalledWith({ top: 1000 + 900 - 72, behavior: 'smooth' });
  });
  it('reduced motion: instant', () => {
    const { win, card, scrollTo } = fakeWin({ stacked: true, reduced: true, cardTop: -300 });
    bringCardIntoView(card, win);
    expect(scrollTo).toHaveBeenCalledWith({ top: 1000 - 300 - 72, behavior: 'instant' });
  });
  it('NEGATIVE: the card top is already on screen below the header: no scroll', () => {
    const { win, card, scrollTo } = fakeWin({ stacked: true, cardTop: 200 });
    expect(bringCardIntoView(card, win)).toBe(false);
    expect(scrollTo).not.toHaveBeenCalled();
  });
  it('NEGATIVE: desktop (side by side) never scrolls', () => {
    const { win, card, scrollTo } = fakeWin({ stacked: false, cardTop: -300 });
    expect(bringCardIntoView(card, win)).toBe(false);
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
