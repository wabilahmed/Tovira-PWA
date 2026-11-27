// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GAME_PAGES, fileOf } from './game-pages.js';
import { GAMES } from './landing-data.js';
import { LINES } from './scene.js';

/**
 * [P89 · owner, Prompt 86] The copy rules, which fail the build if broken (plan/brand.md "Words"):
 *  - no country, city or district names and no people's names in public copy;
 *  - usage in messages, never in currency: currency only in the pricing section;
 *  - the price stays AED 299 a month, 10,000 messages a month, 14 days free (5,000 messages), no card;
 *  - WhatsApp wording is accurate: reps send chats to Tovira; Tovira never logs in, never sends as them, never messages
 *    their clients; never "no connection to WhatsApp"; and no copy tells visitors to send chats to a WhatsApp number
 *    while that number is limited to the owner's account (owner, 27 Nov: "Export a chat" and "upload" are fine);
 *  - the owner's claim corrections of 27 Nov, each pinned both ways (the true wording is there, the false one is not);
 *  - nothing shown as caught contains a word that isn't in the message shown with it;
 *  - no public example shows a bare budget or a decision-maker named only by role, until the next certification
 *    covers them (owner, 27 Nov);
 *  - no competitor named anywhere; no copy promises an alert or a push.
 * Public copy: the landing (its text, its meta and share tags, the scene's background lines) and the seven game pages
 * (their own words: H1, description, close, links, meta). The game's chats are the owner's frozen content
 * (landing-p70-3.test.ts pins them by hash) and were certified on the real model (P71/P73 claim checks); they are held
 * to the places, names and currency rules here, and to the budget and role rule only by report (see BLOCKERS [P89-game]).
 */
const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const landing = new DOMParser().parseFromString(read('apps/web/index.html'), 'text/html');
const games = GAME_PAGES.map((p) => ({ route: p.route, doc: new DOMParser().parseFromString(read(`apps/web/${fileOf(p)}`), 'text/html') }));
const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const metas = (d: Document) => [...d.querySelectorAll('meta[content]')].map((m) => m.getAttribute('content') ?? '').join(' \n ') + ' \n ' + d.title;
/** A game page's own words: everything but the game card. */
const pageWords = (d: Document) => { const b = d.body.cloneNode(true) as HTMLElement; b.querySelector('[data-game]')?.remove(); return norm(b.textContent); };
const LANDING_TEXT = `${norm(landing.body.textContent)} \n ${metas(landing)} \n ${LINES.join(' \n ')}`;
const GAME_PAGE_TEXT = games.map(({ doc }) => `${pageWords(doc)} \n ${metas(doc)}`).join(' \n ');
const GAME_CONTENT = GAMES.flatMap((g) => g.chats.flat().flatMap((m) => [m.t, m.sig ?? '', m.why ?? ''])).join(' \n ');
const PUBLIC = `${LANDING_TEXT} \n ${GAME_PAGE_TEXT}`;

const PLACES = /\b(UAE|U\.A\.E|Emirates|Dubai|Abu Dhabi|Sharjah|Ajman|Ras Al Khaimah|Fujairah|Umm Al Quwain|Al Ain|Riyadh|Jeddah|Dammam|Doha|Muscat|Manama|Kuwait|Cairo|Beirut|Amman|Istanbul|London|Paris|Berlin|Munich|Madrid|Rome|Milan|Geneva|Zurich|New York|Singapore|Hong Kong|Mumbai|Delhi|Bangalore|Karachi|Lahore|Dhaka|Saudi|KSA|Qatar|Oman|Bahrain|Egypt|Lebanon|Jordan|Turkey|India|Pakistan|Bangladesh|UK|USA|America|Canada|Germany|France|Spain|Italy|Switzerland|China|Japan|Russia|Australia|Marina|Downtown|JLT|JBR|JVC|Jumeirah|Palm|Deira|Bur Dubai|Business Bay|Mirdif|Arabian Ranches|Al Barsha|Saadiyat|Yas|Reem|Khalifa|Sheikh Zayed|SZR|Al Reem|Al Raha|Middle East|GCC)\b/;
const NAMES = /\b(Sara|Sarah|Aisha|Fatima|Mariam|Noor|Layla|Huda|Hana|Priya|Anita|Neha|Pooja|Sana|Zara|Emma|Olivia|Sophie|Anna|Maria|Laura|Ahmed|Ahmad|Mohammed|Muhammad|Mohamed|Omar|Ali|Hassan|Khalid|Khaled|Yousef|Youssef|Rashid|Faisal|Tariq|Imran|Iqbal|Khan|Rahul|Raj|Rajesh|Amit|Arjun|Vikram|Ravi|Sanjay|John|James|David|Michael|Peter|Paul|Mark|Tom|Chris|Daniel|Alex|Ben|Sam|Max|Jack|Wabil|Bhavesh)\b/;
const CURRENCY = /\bAED\b|\bUSD\b|\bEUR\b|\bGBP\b|\bINR\b|\bdirhams?\b|\bdh\b|[$€£₹]|\bfils\b/i;

describe('[P89] copy rules: places and people', () => {
  it('NEGATIVE: no country, city or district name in the landing, the game pages or the game', () => {
    for (const [name, txt] of [['landing', LANDING_TEXT], ['game pages', GAME_PAGE_TEXT], ['game content', GAME_CONTENT]] as const) expect(txt.match(PLACES)?.[0] ?? null, name).toBeNull();
  });
  it('NEGATIVE: no person\'s name in the landing, the game pages or the game', () => {
    for (const [name, txt] of [['landing', LANDING_TEXT], ['game pages', GAME_PAGE_TEXT], ['game content', GAME_CONTENT]] as const) expect(txt.match(NAMES)?.[0] ?? null, name).toBeNull();
  });
  it('the guards catch a planted place and name (they are not vacuous)', () => {
    expect('Lovely view of the Marina'.match(PLACES)?.[0]).toBe('Marina');
    expect('Thanks Sara'.match(NAMES)?.[0]).toBe('Sara');
  });
});

describe('[P89] copy rules: messages, never money (currency only in the pricing section)', () => {
  it('the landing outside its pricing card names no currency; the pricing card holds the one price', () => {
    const outside = landing.body.cloneNode(true) as HTMLElement;
    outside.querySelector('[data-pricing]')!.remove();
    expect(norm(outside.textContent).match(CURRENCY)?.[0] ?? null).toBeNull();
    expect(metas(landing).match(CURRENCY)?.[0] ?? null).toBeNull();
    expect(norm(landing.querySelector('[data-pricing]')!.textContent).match(/AED [\d,]+/g)).toEqual(['AED 299']);
  });
  it('NEGATIVE: the game pages and the game name no currency', () => {
    expect(GAME_PAGE_TEXT.match(CURRENCY)?.[0] ?? null).toBeNull();
    expect(GAME_CONTENT.match(CURRENCY)?.[0] ?? null).toBeNull();
  });
  it('the price: AED 299 a month, 10,000 messages a month, 14 days free with 5,000 messages, no card', () => {
    const plan = norm(landing.querySelector('[data-pricing]')!.textContent);
    for (const s of ['AED 299', 'a month', '10,000 messages a month', '14 days free with 5,000 messages. No card.', 'Cancel any time']) expect(plan).toContain(s);
    expect(LANDING_TEXT).toContain('14 days free · No card needed');
  });
  it('NEGATIVE: no annual price until annual checkout is proven (Stripe test mode has no yearly price: BLOCKERS [P89-annual])', () => {
    expect(PUBLIC).not.toMatch(/2,990|a year|per year|annual|yearly/i);
  });
});

describe('[P89] copy rules: WhatsApp wording is accurate', () => {
  it('says what Tovira never does, in the owner\'s words', () => {
    expect(LANDING_TEXT).toContain('Tovira never logs in to your WhatsApp, never messages your clients and never replies for you.');
    expect(LANDING_TEXT).toContain('You send a chat to Tovira. It never logs in to your WhatsApp and never sends anything as you.');
    expect(LANDING_TEXT).toContain('It never logs in, never sends as you and never messages your clients.');
  });
  it('NEGATIVE: never "no connection to WhatsApp" (or "not connected", "never connects")', () => {
    expect(PUBLIC).not.toMatch(/no connection to (your )?WhatsApp|not connected to (your )?WhatsApp|never connects to (your )?WhatsApp/i);
  });
  it('NEGATIVE: no copy tells visitors to send chats to a WhatsApp number (the number is limited to the owner\'s account)', () => {
    expect(PUBLIC).not.toMatch(/WhatsApp number|our number|Tovira's number|\+971|\+1\s?555|send (it|them|the chat|a chat|chats|the file) (to|on) (our|Tovira's|the) WhatsApp|message us on WhatsApp/i);
    expect(LANDING_TEXT).toContain('No. You export a chat and send Tovira the file.');
  });
});

describe('[P89] the owner\'s claim corrections (27 Nov), each pinned both ways', () => {
  const both = (now: string[], never: RegExp) => { for (const s of now) expect(LANDING_TEXT, s).toContain(s); expect(PUBLIC.match(never)?.[0] ?? null).toBeNull(); };
  it('1. reading: "Tovira reads the chat. Months of history, in minutes." (a chatter filter runs first; the limit is 3,000 messages)', () => {
    both(['Tovira reads the chat', 'Months of history, in minutes.'], /reads every line|Years of history|every message you've ever/i);
  });
  it('2. going quiet: 30 days (the alert\'s threshold), and their last message (not what they asked)', () => {
    both(['No reply in 30 days', 'Their last message: "When is the handover?"'], /No reply in 1\d days|Last thing they asked/i);
  });
  it('3. receipts: "Proof for what it catches", on both cards (no "every detail has a receipt")', () => {
    expect(LANDING_TEXT.split('Proof for what it catches').length - 1).toBe(2);
    expect(LANDING_TEXT.split('Every promise and detail links to the message, or voice note, it came from.').length - 1).toBe(2);
    both([], /Every detail has (a receipt|proof)|Each one links to the exact message/i);
  });
  it('4. Find: "Finds it in one tap" (fixed questions, one tap each: missed promises, deals at risk, who hasn\'t replied)', () => {
    both(['Finds it in one tap', 'Missed promises, deals at risk, clients going quiet.'], /Finds anything|who wants what|ask (it )?anything/i);
  });
  it('5. voice notes: the rep records under a client, Tovira writes it up there', () => {
    both(['Talk after a meeting. Tovira writes it up under that client.'], /Tovira files it\.|files it for you|sorts it (into|to) the right client/i);
  });
  it('6. timing: the brief is ready; nothing promises an alert or a push', () => {
    both(['Your brief is ready before the meeting', 'Open it and walk in prepared.', 'Then has it ready before the meeting.'], /speaks up in time|Before the meeting, not after|hands it to you|brings it up|\bpush(es|ed)?\b|\bnotif|\balerts?\b|remind(s|er)|\bpings?\b/i);
  });
  it('7. the caught card: "Loves the beach. Every weekend." (nothing the message did not say)', () => {
    both(['Loves the beach. Every weekend.'], /with the kids/i);
  });
  it('8. the trial: 14 days free with 5,000 messages, no card (not the plan\'s 10,000)', () => {
    both(['14 days free with 5,000 messages. No card.'], /14 days free,? no card(?! needed)|10,000 messages free/i);
  });
  it('9. no "send it to our WhatsApp number" while the number is limited (see the WhatsApp rules above)', () => {
    both(['Export a chat'], /WhatsApp number/i);
  });
  it('the "Different on purpose" claims, as checked on 27 Nov (the daily digest is real; Tovira only sees what it is sent)', () => {
    both(['AI chatbots wait to be asked. Tovira speaks first.', 'Every day it tells you what needs your attention.', 'Tovira only sees the chats you send.'], /reads all your chats|connects to your inbox/i);
  });
});

describe('[P89] nothing shown as caught contains a word that isn\'t in the message shown', () => {
  const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9' ]/g, ' ').split(/\s+/).filter(Boolean);
  it('the scene: the caught card\'s words are the marked message\'s words, and "loves" (the owner\'s wording, 27 Nov)', () => {
    const said = new Set(words(norm(landing.getElementById('big')!.textContent)));
    const caught = words(norm(landing.querySelector('#b4 .card strong')!.textContent));
    const extra = caught.filter((w) => !said.has(w));
    expect(extra).toEqual(['loves']);
  });
  it('the receipt card shows a quote and no caught line beside it; the briefs show no quote beside them', () => {
    const receipt = [...landing.querySelectorAll('.t2-card')].find((c) => norm(c.textContent).startsWith('RECEIPT'))!;
    expect(norm(receipt.textContent)).toContain('"We\'d need it before September."');
    for (const brief of [landing.querySelector('.brief')!, [...landing.querySelectorAll('.t2-card')].find((c) => norm(c.textContent).startsWith('BEFORE YOUR 3PM'))!]) expect(norm(brief.textContent)).not.toMatch(/"/);
  });
});

describe('[P89] no bare budget and no decision-maker named only by role (until the next certification covers them)', () => {
  const RULE = /\bbudgets?\b|family office|who (really )?decides|makes the call|\b(CFO|CEO|COO|MD|boss|board|director|husband|wife|partner|manager|owner)\b[^.]{0,40}\b(decides?|signs?( off)?|sets|approves|makes)\b/i;
  it('NEGATIVE: none on the landing (its examples, its cards, the scene, its background lines) or the game pages\' own words', () => {
    expect(LANDING_TEXT.match(RULE)?.[0] ?? null).toBeNull();
    expect(GAME_PAGE_TEXT.match(RULE)?.[0] ?? null).toBeNull();
  });
  it('the brief examples are the owner\'s three, everywhere', () => {
    const three = ['Wants a sea view', 'Decides before September', 'Worried about the service charge'];
    expect([...landing.querySelectorAll('.brief li')].map((l) => norm(l.textContent))).toEqual(three);
    const card = [...landing.querySelectorAll('.t2-card')].find((c) => norm(c.textContent).startsWith('BEFORE YOUR 3PM'))!;
    expect([...card.querySelectorAll('span')].map((l) => norm(l.textContent))).toEqual(three);
    expect(LANDING_TEXT).toContain('What they love, their deadline, what worries them.');
  });
  it('the guard catches the old examples (it is not vacuous)', () => {
    for (const old of ['The family office sets the budget', 'Budget set by the family office', 'What they love, their budget, their deadline, who decides.', 'The CFO really decides', 'Husband signs off over 3M']) expect(old.match(RULE), old).not.toBeNull();
  });
});

describe('[P89] no competitor named anywhere public', () => {
  it('NEGATIVE: no CRM, chatbot or notetaker brand on the landing or the game pages', () => {
    expect(PUBLIC.match(/ChatGPT|OpenAI|Claude|Gemini|Copilot|Perplexity|Salesforce|HubSpot|Zoho|Pipedrive|Monday\.com|Otter|Fireflies|Gong|Fathom|Notion|Superhuman/i)?.[0] ?? null).toBeNull();
  });
});
