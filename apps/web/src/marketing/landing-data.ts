/**
 * [P70 · owner] The landing page's data, copied verbatim from renderVals() in the approved design
 * (plan/tovira-landing-reference.dc.html). The six industries, the five game chats, the chat wall, the marquee and
 * the star field. Change nothing here without the owner: every "Tovira caught" line is a claim the product must keep.
 * Owner changes from the design (P70): no country named (P51: "the UAE" and "SZR" removed), and the Europe line in chat
 * 2 says the need ("so the cover has to work there too"), because the drawn line was caught only 3/5.
 */
export const ACCENT = '#E8643A';

export interface World { label: string; before: string; buried: string; after: string; source: string; caught: string; move: string }

export const WORLDS: World[] = [
  { label: 'Property', before: 'Saturday is hard, kids have football. Honestly ', buried: "we're at the beach every weekend", after: ', can we do Sunday?', source: 'WhatsApp · 12 Mar', caught: 'Loves the beach. Every weekend, with the kids.', move: 'Lead with the sea-view units.' },
  { label: 'Insurance', before: "Can we sign after I'm back from Munich? ", buried: "I'm in Europe most months for work", after: ', the travel is killing me.', source: 'Voice note · 4 Feb', caught: 'Travels to Europe most months.', move: 'Bring a policy that covers him in Europe too.' },
  { label: 'Wealth', before: 'All good this side. ', buried: 'Our daughter starts at LSE in September', after: ', so we want to keep things liquid this year.', source: 'WhatsApp · 20 Jan', caught: 'Daughter at LSE from September. Wants liquidity.', move: 'Raise education funding before September.' },
  { label: 'B2B accounts', before: 'Our MD will sign, but ', buried: 'honestly the CFO makes the call', after: '. Send it before the board on the 14th.', source: 'WhatsApp · 8 Apr', caught: 'The CFO really decides. Board meets on the 14th.', move: 'Get the revised SLA to the CFO by the 13th.' },
  { label: 'Luxury', before: 'Thank you for last time! ', buried: 'She still talks about that emerald set', after: ". Our anniversary's in May.", source: 'WhatsApp · 17 Feb', caught: 'Anniversary in May. She loved the emerald set.', move: 'Call in early May about emeralds.' },
  { label: 'Recruitment', before: 'Happy to talk. ', buried: "Honestly, I'd only move for hybrid, three days in the office max", after: '.', source: 'Voice note · 12 Jan', caught: 'Wants hybrid. Three office days at most.', move: 'Shortlist hybrid roles first.' },
];

export interface Msg { t: string; sig?: string; why?: string }
export interface Round { name: string; initials: string; level: string; tag: string; spare: number; pts: number; msgs: Msg[] }

// Game: 5 chats, 12 details, each chat harder than the last (more chatter, subtler details, fewer spare taps, more points).
// Every "sig" must be something Tovira really catches (P70 claim check). "why" explains why the detail helps close.
export const ROUNDS: Round[] = [
  { name: 'Property client', initials: '1', level: 'EASY', tag: 'WhatsApp · details said plainly', spare: 2, pts: 100, msgs: [
    { t: 'Hi! Saw the listing you sent, thanks' },
    { t: 'we love the beach, we go every single weekend', sig: 'Loves the beach', why: "It's how she wants to live, not just where. Homes near the water will feel right to her before she even visits." },
    { t: 'can we do Sunday evening?' },
    { t: 'my husband signs off on anything over 3M', sig: 'Husband signs off over 3M', why: 'You now know the budget ceiling and who else has to say yes. Bring him into the viewing, or the deal stalls later.' },
    { t: 'perfect, see you then' },
  ] },
  { name: 'Insurance client', initials: '2', level: 'WARMING UP', tag: 'Voice note · one detail tucked inside a question', spare: 1, pts: 150, msgs: [
    { t: 'Got the quote, thanks for sending' },
    { t: "can we sign after I'm back? I'm in Europe most months for work, so the cover has to work there too", sig: 'Travels to Europe most months', why: "A policy that only covers home won't fit his life. Cover for Europe is what makes your offer the right one." },
    { t: 'haha long week' },
    { t: 'send me the pdf when you can' },
    { t: 'by the way my current policy renews on 1 March', sig: 'Renewal on 1 March', why: 'A hard deadline. Miss it and he rolls over with his current insurer by default.' },
    { t: 'will call you tomorrow' },
  ] },
  { name: 'Wealth client', initials: '3', level: 'TRICKY', tag: 'WhatsApp · details hidden in small talk', spare: 1, pts: 200, msgs: [
    { t: 'Thanks for the call earlier' },
    { t: 'hope the family is well' },
    { t: 'all good this side, our daughter starts at LSE in September', sig: 'Daughter at LSE from September', why: 'University fees in pounds start in September. Education planning just became urgent, and you know the date.' },
    { t: 'did you watch the match last night?' },
    { t: "so we'd rather keep things liquid this year", sig: 'Wants liquidity', why: "Anything that locks money away is a no this year. Flexible options are the only ones he'll say yes to." },
    { t: 'send me the usual report' },
    { t: 'cheers' },
  ] },
  { name: 'B2B account', initials: '4', level: 'HARD', tag: 'WhatsApp · the real decision-maker is never named', spare: 1, pts: 300, msgs: [
    { t: 'Thanks for the call today' },
    { t: 'overall the proposal looks good' },
    { t: 'our MD will sign, but honestly the CFO makes the call', sig: 'The CFO really decides', why: 'The person you have been pitching is not the one who decides. Win over the CFO, or the signature never comes.' },
    { t: 'ok sent you our deck as well' },
    { t: "she's been burned by slow support before", sig: 'Worried about slow support', why: 'This is her real objection. Answer it before she raises it and the biggest reason to say no is gone.' },
    { t: 'the office is chaos this week' },
    { t: 'send the revised SLA before the board on the 14th', sig: 'Board meets on the 14th', why: 'A deadline you did not set. Get it in late and the decision slips to next quarter.' },
    { t: 'talk soon' },
  ] },
  { name: 'Luxury client', initials: '5', level: 'EXPERT · NO SPARE TAPS', tag: 'WhatsApp · everything said in passing', spare: 0, pts: 500, msgs: [
    { t: 'Thank you for last time!' },
    { t: 'the traffic was insane haha' },
    { t: 'she still talks about that emerald set', sig: 'She loved the emerald set', why: "She's already picked what she wants. Show the emerald set and you're not selling, you're reminding." },
    { t: 'my brother just bought a watch, so expensive' },
    { t: "can't believe it's ten years in May", sig: 'Tenth anniversary in May', why: 'A milestone anniversary with a month attached. Call in April, not after it has passed.' },
    { t: 'sorry for the late reply' },
    { t: 'she only wears gold anyway, never silver', sig: 'She wears gold, never silver', why: 'It rules out half the options before you start. Show only gold and every piece you bring is one she could say yes to.' },
    { t: 'thanks again for everything' },
    { t: 'ok bye!' },
  ] },
];

export interface WallLine { t: string; m?: boolean }
export const WALL_A: WallLine[] = [
  { t: 'ok thanks' }, { t: 'see you tmrw' }, { t: 'my wife decides on these things', m: true }, { t: 'sent' },
  { t: 'can you resend the pdf' }, { t: 'running 10 min late' }, { t: 'budget is max 2.5', m: true }, { t: 'done' },
  { t: 'call you after lunch' }, { t: 'perfect' }, { t: 'kids start school in Sept', m: true }, { t: 'noted' },
];
export const WALL_B: WallLine[] = [
  { t: 'haha yes' }, { t: 'which floor was it?' }, { t: "I'm in London most of June", m: true }, { t: 'thank you!' },
  { t: 'will check and revert' }, { t: 'ok' }, { t: 'last broker never called back', m: true }, { t: 'call me pls' },
  { t: 'got it' }, { t: 'sunday works' }, { t: 'renewal is in March', m: true }, { t: 'sure' },
];
export const WALL_C: WallLine[] = [
  { t: 'sounds good' }, { t: 'traffic is crazy' }, { t: 'we love the sea view', m: true }, { t: 'yes please' },
  { t: 'what time?' }, { t: 'thx' }, { t: 'my partner gets back on the 20th', m: true }, { t: 'ok cool' },
  { t: 'send me options' }, { t: 'on my way' }, { t: 'no more than 3 days office', m: true }, { t: 'great' },
];

export const MARQ_A = ['Loves the beach', 'The CFO really decides', 'Board meets on the 14th', 'Travels to Europe most months', 'Anniversary in May', 'Wants hybrid'];
export const MARQ_B = ['Daughter at LSE from September', 'Loved the emerald set', 'Renewal on 1 March', 'Worried about slow support', 'Husband signs off over 3M', 'Wants liquidity', 'Wears gold, never silver'];

/** The chat wall: each column twice, so the -50% rise loops seamlessly. Missed lines glow. */
export function wall(lines: WallLine[]): Array<{ text: string; cls: string; color: string }> {
  return lines.concat(lines).map((l) => ({ text: l.t, cls: l.m ? 'tv-missed' : '', color: l.m ? '#FFD9C9' : '#9C9389' }));
}

/** The marquee: each row twice, coloured in a repeating muted / accent / text pattern. */
export function marq(items: string[]): Array<{ t: string; color: string }> {
  return items.concat(items).map((t, i) => ({ t, color: i % 3 === 1 ? '#E8643A' : (i % 3 === 2 ? '#F2EDE4' : '#4A423B') }));
}

/** The 28 stars, from the design's seeded generator (same seed, same sky). About 1 in 5 is gold. */
export function stars(): string[] {
  const out: string[] = [];
  let seed = 7;
  const rnd = (): number => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  for (let i = 0; i < 28; i++) {
    const size = 1.5 + rnd() * 2.5;
    const gold = rnd() > 0.8;
    out.push('left:' + (rnd() * 100).toFixed(1) + '%;top:' + (rnd() * 100).toFixed(1) + '%;width:' + size.toFixed(1) + 'px;height:' + size.toFixed(1) + 'px;' + (gold ? 'background:#F2B84B;box-shadow:0 0 8px rgba(242,184,75,.9);' : '') + 'animation-duration:' + (2.5 + rnd() * 4).toFixed(1) + 's,' + (6 + rnd() * 8).toFixed(1) + 's;animation-delay:-' + (rnd() * 6).toFixed(1) + 's,-' + (rnd() * 6).toFixed(1) + 's');
  }
  return out;
}
