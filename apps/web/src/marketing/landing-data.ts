/**
 * [P70 · owner] The landing page's data, copied verbatim from renderVals() in the approved design
 * (plan/tovira-landing-reference.dc.html). The six industries, the game's 30 chats (P71), the chat wall, the marquee and
 * the star field. Change nothing here without the owner: every "Tovira caught" line is a claim the product must keep.
 * Owner changes from the design (P70): no country named (P51: "the UAE" and "SZR" removed), and the Europe line in chat
 * 2 says the need ("so the cover has to work there too"), because the drawn line was caught only 3/5.
 */
export const ACCENT = '#E8643A';

export interface World { label: string; before: string; buried: string; after: string; source: string; caught: string; move: string }

export const WORLDS: World[] = [
  { label: 'Property', before: 'Saturday is hard, kids have football. Honestly ', buried: "we're at the beach every weekend", after: ', can we do Sunday?', source: 'WhatsApp · 12 Mar', caught: 'Loves the beach. Every weekend, with the kids.', move: 'Lead with the sea-view units.' },
  { label: 'Insurance', before: "Can we sign after I'm back from Munich? ", buried: "I'm in Europe most months for work", after: ', the travel is killing me.', source: 'Voice note · 4 Feb', caught: 'Travels to Europe most months.', move: 'Bring a policy that covers Europe too.' },
  { label: 'Wealth', before: 'All good this side. ', buried: 'Our daughter starts at LSE in September', after: ', so we want to keep things liquid this year.', source: 'WhatsApp · 20 Jan', caught: 'Daughter at LSE from September. Wants liquidity.', move: 'Raise education funding before September.' },
  { label: 'B2B accounts', before: 'Our MD will sign, but ', buried: 'honestly the CFO makes the call', after: '. Send it before the board on the 14th.', source: 'WhatsApp · 8 Apr', caught: 'The CFO really decides. Board meets on the 14th.', move: 'Get the revised SLA to the CFO by the 13th.' },
  { label: 'Luxury', before: 'Thank you for last time! ', buried: 'She still talks about that emerald set', after: ". Our anniversary's in May.", source: 'WhatsApp · 17 Feb', caught: 'Anniversary in May. She loved the emerald set.', move: 'Call in early May about emeralds.' },
  { label: 'Recruitment', before: 'Happy to talk. ', buried: "Honestly, I'd only move for hybrid, three days in the office max", after: '.', source: 'Voice note · 12 Jan', caught: 'Wants hybrid. Three office days at most.', move: 'Shortlist hybrid roles first.' },
];

export interface Msg { t: string; sig?: string; why?: string }
export interface Game { label: string; chats: Msg[][] }

// [P71 · owner] Game: pick an industry, play its 5 chats. Copied verbatim from the design's games array
// (landing-p70-3.test.ts pins it). Every "sig" must be something Tovira really catches (claim check).
// [P73 · owner] "A real challenge": every chat has 5 messages, 1 to 3 details (10 to 11 per industry); every wrong
// answer is a believable trap with its "Why not" reason, one of the five below. A trap may be stored by Tovira, but
// never as something a rep would read as a buying signal (claim check).
export const TRAP_REASONS = ["Polite, but it tells you nothing about what they want.", "Logistics. Handle it, but it will not change what you offer.", "Every client says this. It tells you nothing about this one.", "Every maybe sounds like this. There is nothing specific to act on.", "Small talk. Nothing to act on."];
export const GAMES: Game[] = [
  { label: "Property", chats: [
    [
      { t: "Thanks, the listings you sent look interesting", why: "Polite, but it tells you nothing about what they want." },
      { t: "We need at least 3 bedrooms, the kids share a room right now", sig: "Needs 3+ bedrooms", why: "Anything smaller is a wasted viewing. Now you know what to filter out before you send a single listing." },
      { t: "Can you send the floor plans as a PDF?", why: "Logistics. Handle it, but it will not change what you offer." },
      { t: "Sorry for the slow reply, it's been a crazy week", why: "Small talk. Nothing to act on." },
      { t: "We just want somewhere nice, you know?", why: "Every client says this. It tells you nothing about this one." },
    ],
    [
      { t: "We love the beach, we go every single weekend", sig: "Loves the beach", why: "It's how she wants to live, not just where. Homes near the water will feel right before she even visits." },
      { t: "Can we move the viewing to 6pm instead?", why: "Logistics. Handle it, but it will not change what you offer." },
      { t: "My husband signs off on anything over 3M", sig: "Husband signs off over 3M", why: "You now know the budget ceiling and who else has to say yes. Bring him into the viewing, or the deal stalls later." },
      { t: "The building looked nice from the outside", why: "Every client says this. It tells you nothing about this one." },
      { t: "Perfect, see you then", why: "Polite, but it tells you nothing about what they want." },
    ],
    [
      { t: "Honestly the commute is what kills me, I want to be near the office", sig: "Wants a short commute", why: "Lead with location, not finishes. The right address matters more to him than the kitchen." },
      { t: "Thanks for showing us around today", why: "Polite, but it tells you nothing about what they want." },
      { t: "We're selling our current place first", sig: "Selling current home first", why: "His timing depends on a sale. Ask how it is going, and you will know when he can actually buy." },
      { t: "Is the show flat open on Saturdays?", why: "Logistics. Handle it, but it will not change what you offer." },
      { t: "Ideally we move before the school year starts in September", sig: "Wants to move before September", why: "A deadline he set himself. Show what can be ready by then and you remove the biggest risk." },
    ],
    [
      { t: "My mother lives with us, so a ground-floor bedroom matters", sig: "Needs a ground-floor bedroom", why: "Any home without one is a no, however nice it is. It also shows how much family shapes this decision." },
      { t: "We'd like a good deal, like everyone", why: "Every client says this. It tells you nothing about this one." },
      { t: "We're paying cash, we won't need a mortgage", sig: "Paying cash", why: "A cash buyer can move fast. That changes which sellers you call first and how hard you can negotiate." },
      { t: "Could you resend the brochure? I lost it", why: "Logistics. Handle it, but it will not change what you offer." },
      { t: "Let me think it over and get back to you", why: "Every maybe sounds like this. There is nothing specific to act on." },
    ],
    [
      { t: "The kids keep asking for a pool", sig: "Kids want a pool", why: "The kids get a vote. A pool could be what tips the family from maybe to yes." },
      { t: "The traffic on the way back was terrible", why: "Small talk. Nothing to act on." },
      { t: "I work from home, so a study is a must", sig: "Needs a study (works from home)", why: "A must, not a nice-to-have. Homes without a real study are out." },
      { t: "Your team has been really helpful so far", why: "Polite, but it tells you nothing about what they want." },
      { t: "And nothing facing west, my wife hates the afternoon heat", sig: "No west-facing homes", why: "One detail that rules out half the options. Skip west-facing units and every viewing counts." },
    ],
  ] },
  { label: "Insurance", chats: [
    [
      { t: "Got the quote, thanks for sending it so quickly", why: "Polite, but it tells you nothing about what they want." },
      { t: "My current policy renews on 1 March", sig: "Renewal on 1 March", why: "A hard deadline. Miss it and he rolls over with his current insurer by default." },
      { t: "Can you call me after 5? I'm in meetings all day", why: "Logistics. Handle it, but it will not change what you offer." },
      { t: "We just want good cover at a fair price", why: "Every client says this. It tells you nothing about this one." },
      { t: "I'll read it properly tonight", why: "Every maybe sounds like this. There is nothing specific to act on." },
    ],
    [
      { t: "Can we sign after I'm back? I'm in Europe most months for work, so the cover has to work there too", sig: "Travels to Europe most months", why: "A policy that only covers home won't fit his life. Cover for Europe is what makes your offer the right one." },
      { t: "My wife and two kids need to be on it too", sig: "Wife and two kids to be covered", why: "This is a family policy, not a single one. Quote for four and you are in the right conversation." },
      { t: "Is there a PDF version I can forward?", why: "Logistics. Handle it, but it will not change what you offer." },
      { t: "My last insurer took four months to pay a claim", sig: "Worried about slow claims", why: "His real objection. Show how fast your claims are paid and the biggest doubt is gone." },
      { t: "Sounds good overall", why: "Every client says this. It tells you nothing about this one." },
    ],
    [
      { t: "I do a lot of scuba diving, is that covered?", sig: "Goes scuba diving", why: "If diving is excluded, the policy is useless to him. Check it before he finds out the hard way." },
      { t: "Thanks for the call earlier", why: "Polite, but it tells you nothing about what they want." },
      { t: "I'm looking for a policy around 800 a month", sig: "Budget about 800 a month", why: "Now you know what to quote. Going far above it wastes both your time." },
      { t: "Sorry, I missed your call this morning", why: "Small talk. Nothing to act on." },
      { t: "Let me compare and come back to you", why: "Every maybe sounds like this. There is nothing specific to act on." },
    ],
    [
      { t: "My daughter just got her licence and will drive my car", sig: "Daughter now drives his car", why: "A new young driver changes the cover he needs. Raise it before a claim does." },
      { t: "Can you send the documents by email instead?", why: "Logistics. Handle it, but it will not change what you offer." },
      { t: "I'm self-employed, so I need income cover", sig: "Self-employed, wants income cover", why: "No employer is protecting his income. That is the product he actually needs." },
      { t: "We want to be properly covered, obviously", why: "Every client says this. It tells you nothing about this one." },
      { t: "Thanks for being patient with all my questions", why: "Polite, but it tells you nothing about what they want." },
    ],
    [
      { t: "My parents are moving in with us next year", sig: "Parents moving in next year", why: "Two more people in the home next year. Home and family cover both need to change." },
      { t: "The traffic was crazy today", why: "Small talk. Nothing to act on." },
      { t: "Honestly I just want one person to call when something goes wrong", sig: "Wants one point of contact", why: "He is not buying a policy, he is buying you. Make it clear you are that one person." },
      { t: "Insurance is so confusing, isn't it", why: "Every client says this. It tells you nothing about this one." },
      { t: "Talk soon, have a good weekend", why: "Polite, but it tells you nothing about what they want." },
    ],
  ] },
  { label: "Wealth", chats: [
    [
      { t: "Thanks for the quarterly report", why: "Polite, but it tells you nothing about what they want." },
      { t: "Our daughter starts at LSE in September", sig: "Daughter at LSE from September", why: "University fees in pounds start in September. Education planning just became urgent, and you know the date." },
      { t: "Can we move our review to Thursday?", why: "Logistics. Handle it, but it will not change what you offer." },
      { t: "So we'd rather keep things liquid this year", sig: "Wants liquidity", why: "Anything that locks money away is a no this year. Flexible options are the only ones he'll say yes to." },
      { t: "We want our money to grow, like everyone", why: "Every client says this. It tells you nothing about this one." },
    ],
    [
      { t: "Hope all is well with you", why: "Polite, but it tells you nothing about what they want." },
      { t: "I want to retire at 55", sig: "Wants to retire at 55", why: "His real goal, in one line. Every plan you show should answer: does this get him there?" },
      { t: "Can you send the statement as a PDF?", why: "Logistics. Handle it, but it will not change what you offer." },
      { t: "Sounds sensible, let me think about it", why: "Every maybe sounds like this. There is nothing specific to act on." },
      { t: "Sorry for the late reply", why: "Small talk. Nothing to act on." },
    ],
    [
      { t: "I don't want anything I can't explain to my wife", sig: "Wants products he can explain simply", why: "Complex products lose him, however good they are. Keep it simple enough to explain at dinner." },
      { t: "Thanks for the call earlier", why: "Polite, but it tells you nothing about what they want." },
      { t: "My bonus lands in March", sig: "Bonus in March", why: "Money arrives in March. Call before then, not after it is already spent." },
      { t: "Is the review still on for Tuesday?", why: "Logistics. Handle it, but it will not change what you offer." },
      { t: "And nothing in tobacco, it's a principle thing", sig: "No tobacco investments", why: "Break this rule once and you lose his trust. Screen it out of every portfolio you show." },
    ],
    [
      { t: "My father is passing the family business to me", sig: "Taking over the family business", why: "A big change in wealth and in what he needs from you: succession, tax and cash flow." },
      { t: "We want low risk and good returns", why: "Every client says this. It tells you nothing about this one." },
      { t: "We're thinking of buying a holiday home in a couple of years", sig: "Plans a holiday home in a couple of years", why: "A goal with a rough timeline. Plan for the deposit now and you are part of the dream." },
      { t: "Could you resend the login for the portal?", why: "Logistics. Handle it, but it will not change what you offer." },
      { t: "Talk soon", why: "Polite, but it tells you nothing about what they want." },
    ],
    [
      { t: "The last advisor kept pushing products on me, I hated that", sig: "Dislikes being sold to", why: "Pitch hard and you become the last advisor. Ask questions, and let him choose." },
      { t: "Thanks for being so patient", why: "Polite, but it tells you nothing about what they want." },
      { t: "My son wants to study medicine", sig: "Son wants to study medicine", why: "Medicine is a long, expensive degree. Education planning starts now." },
      { t: "I'd like to give more to charity every year", sig: "Wants to give to charity yearly", why: "A value he cares about. Building giving into his plan shows you listened." },
      { t: "Can we do the next call on Zoom?", why: "Logistics. Handle it, but it will not change what you offer." },
    ],
  ] },
  { label: "B2B accounts", chats: [
    [
      { t: "Thanks for the demo, the team enjoyed it", why: "Polite, but it tells you nothing about what they want." },
      { t: "We need it live before our busy season in October", sig: "Must go live before October", why: "Their deadline, not yours. A plan that lands after October is a no." },
      { t: "Can you send the slides from today?", why: "Logistics. Handle it, but it will not change what you offer." },
      { t: "We want a solution that just works", why: "Every client says this. It tells you nothing about this one." },
      { t: "Let's catch up again soon", why: "Every maybe sounds like this. There is nothing specific to act on." },
    ],
    [
      { t: "Procurement needs three quotes before anything is signed", sig: "Needs three quotes", why: "You are being compared, whatever they say. Make sure your quote is the easiest one to say yes to." },
      { t: "The pricing page was clear, thanks", why: "Polite, but it tells you nothing about what they want." },
      { t: "Send the revised SLA before the board on the 14th", sig: "Board meets on the 14th", why: "A deadline you did not set. Get it in late and the decision slips to next quarter." },
      { t: "We're excited about this", why: "Every client says this. It tells you nothing about this one." },
      { t: "Sorry, my calendar is a mess this week", why: "Small talk. Nothing to act on." },
    ],
    [
      { t: "Our last vendor's support was painfully slow", sig: "Worried about slow support", why: "This is their real objection. Answer it before they raise it and the biggest reason to say no is gone." },
      { t: "Thanks for the call today", why: "Polite, but it tells you nothing about what they want." },
      { t: "We'd need a named account manager in the SLA this time", sig: "Wants a named account manager", why: "A requirement said once, in passing. Put it in the proposal and you have answered a no before they say it." },
      { t: "Can you share the case study as a PDF?", why: "Logistics. Handle it, but it will not change what you offer." },
      { t: "We need it to work for 40 people now, and 60 next year", sig: "Needs it for 40 now, 60 next year", why: "Price for 60, not 40. Growth is your next upsell." },
    ],
    [
      { t: "Budget is fixed this year, but it resets in January", sig: "Budget resets in January", why: "Not a no, a not yet. Call in January." },
      { t: "Great meeting you in person", why: "Polite, but it tells you nothing about what they want." },
      { t: "We use Microsoft for everything, it has to plug into that", sig: "Must work with Microsoft", why: "If it does not connect, nothing else matters. Lead with the integration." },
      { t: "We want good value, obviously", why: "Every client says this. It tells you nothing about this one." },
      { t: "I'll go through the proposal over the weekend", why: "Every maybe sounds like this. There is nothing specific to act on." },
    ],
    [
      { t: "Honestly the price worries us, it has to save us at least one hire", sig: "Price worry: must save one hire", why: "They told you how to justify the price. Show the hire it saves." },
      { t: "We got burned on a three-year contract before, so one year to start", sig: "Wants a one-year contract to start", why: "Push a long contract and you lose the deal. Offer a year." },
      { t: "Can we move Thursday's call to Friday?", why: "Logistics. Handle it, but it will not change what you offer." },
      { t: "Our financial year ends in March", sig: "Financial year ends in March", why: "Budgets get spent or lost before March. A date that can speed up the yes." },
      { t: "Thanks for all the detail", why: "Polite, but it tells you nothing about what they want." },
    ],
  ] },
  { label: "Luxury", chats: [
    [
      { t: "Thank you for last time!", why: "Polite, but it tells you nothing about what they want." },
      { t: "My wife still talks about that emerald set", sig: "Wife loved the emerald set", why: "She's already picked what she wants. Show the emerald set and you're not selling, you're reminding." },
      { t: "Is the boutique open late on Thursdays?", why: "Logistics. Handle it, but it will not change what you offer." },
      { t: "Can't believe it's ten years in May", sig: "Tenth anniversary in May", why: "A milestone anniversary with a month attached. Call in April, not after it has passed." },
      { t: "We want something special, of course", why: "Every client says this. It tells you nothing about this one." },
    ],
    [
      { t: "Hi! Hope you're well", why: "Polite, but it tells you nothing about what they want." },
      { t: "My wife only wears gold, never silver", sig: "Wife wears gold, never silver", why: "It rules out half the options before you start. Show only gold and every piece you bring is one she could say yes to." },
      { t: "Can you send me a few photos on WhatsApp?", why: "Logistics. Handle it, but it will not change what you offer." },
      { t: "Something elegant would be nice", why: "Every client says this. It tells you nothing about this one." },
      { t: "Thanks, speak soon", why: "Polite, but it tells you nothing about what they want." },
    ],
    [
      { t: "My daughter graduates in June", sig: "Daughter graduates in June", why: "A gift moment with a date. Reach out in May with ideas." },
      { t: "Lovely to see you yesterday", why: "Polite, but it tells you nothing about what they want." },
      { t: "She wants something she can wear every day, nothing flashy", sig: "Wants an everyday piece, nothing flashy", why: "Bring statement pieces and you miss. Understated and wearable is the brief." },
      { t: "Is there parking near the store?", why: "Logistics. Handle it, but it will not change what you offer." },
      { t: "I'm looking for something around 20k", sig: "Budget about 20k", why: "Now you know what to show. Stay near it and the choice feels easy." },
    ],
    [
      { t: "The traffic was insane on the way back", why: "Small talk. Nothing to act on." },
      { t: "My wife's birthday is on 3 April", sig: "Wife's birthday 3 April", why: "A date to remember for him. Call in March and you have solved his problem." },
      { t: "We want quality, that's the main thing", why: "Every client says this. It tells you nothing about this one." },
      { t: "She has small wrists, the last bracelet kept sliding off", sig: "Wife has small wrists", why: "Show pieces sized for her and you look like you know her." },
      { t: "Thanks for the coffee", why: "Polite, but it tells you nothing about what they want." },
    ],
    [
      { t: "I collect vintage watches, mostly from the 60s", sig: "Collects 1960s vintage watches", why: "A passion, not a purchase. Call when a 60s piece comes in." },
      { t: "Sorry for the late reply", why: "Small talk. Nothing to act on." },
      { t: "My son turns 18 in August", sig: "Son turns 18 in August", why: "A big birthday with a month. A watch for his 18th is an easy yes." },
      { t: "I prefer to see pieces privately, not in the store", sig: "Prefers private viewings", why: "Invite him to a private viewing. Asking him into the store works against you." },
      { t: "Can you send the catalogue as a PDF?", why: "Logistics. Handle it, but it will not change what you offer." },
    ],
  ] },
  { label: "Recruitment", chats: [
    [
      { t: "Happy to have a chat", why: "Polite, but it tells you nothing about what they want." },
      { t: "Honestly, I'd only move for hybrid, three days in the office max", sig: "Wants hybrid, three office days max", why: "Anything more in the office is a no. Shortlist hybrid roles first." },
      { t: "Can we talk after 6? I'm at work all day", why: "Logistics. Handle it, but it will not change what you offer." },
      { t: "I want a good company with a good culture", why: "Every client says this. It tells you nothing about this one." },
      { t: "Thanks for reaching out", why: "Polite, but it tells you nothing about what they want." },
    ],
    [
      { t: "My notice period is three months", sig: "Three-month notice period", why: "Clients need to know before they make an offer. Say it upfront and avoid a late surprise." },
      { t: "Can you send the job description as a PDF?", why: "Logistics. Handle it, but it will not change what you offer." },
      { t: "I won't go below my current package", sig: "Won't take a pay cut", why: "Roles that pay less waste everyone’s time. Filter them out now." },
      { t: "I'm open to hearing what's out there", why: "Every client says this. It tells you nothing about this one." },
      { t: "Sorry, I missed your call", why: "Small talk. Nothing to act on." },
    ],
    [
      { t: "I want to lead a team in my next role", sig: "Wants to lead a team", why: "A step up, not a sideways move. Only show roles with people to manage." },
      { t: "Thanks for the call", why: "Polite, but it tells you nothing about what they want." },
      { t: "No more startups, I want stability", sig: "Wants stability, no startups", why: "Rule out early-stage companies. Established names will land better." },
      { t: "My bonus pays out in April, I would move after that", sig: "Bonus in April, moves after", why: "Start dates before April will fail. Plan the process to land after it." },
      { t: "Speak soon", why: "Polite, but it tells you nothing about what they want." },
    ],
    [
      { t: "I'm finishing my MBA in December", sig: "Finishing an MBA in December", why: "New skills from December. Roles that use them will interest him most." },
      { t: "I want a role where I can grow", why: "Every client says this. It tells you nothing about this one." },
      { t: "I'd relocate for the right role", sig: "Open to relocating", why: "Your pool of roles just got much bigger." },
      { t: "Can we do the call on Teams?", why: "Logistics. Handle it, but it will not change what you offer." },
      { t: "Thanks for being so quick", why: "Polite, but it tells you nothing about what they want." },
    ],
    [
      { t: "My manager left last month and it's not the same", sig: "Unsettled since the manager left", why: "Why he is really looking. A strong manager in the new role is your best pitch." },
      { t: "Sorry, it's been a busy week", why: "Small talk. Nothing to act on." },
      { t: "I've always wanted to work in fintech", sig: "Wants to move into fintech", why: "His dream sector. A fintech role will get his attention before any other." },
      { t: "My partner works in banking, so no roles at the big banks", sig: "Avoids roles at the big banks", why: "Send a big-bank role and he will wonder if you listened. Leave them out." },
      { t: "Thanks, that's helpful", why: "Polite, but it tells you nothing about what they want." },
    ],
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
export const MARQ_B = ['Daughter at LSE from September', 'Loved the emerald set', 'Renewal on 1 March', 'Worried about slow support', 'Husband signs off over 3M', 'Wants liquidity', 'Wife wears gold, never silver', 'Wants a named account manager'];

/** The chat wall: each column twice, so the -50% rise loops seamlessly. Missed lines glow. */
export function wall(lines: WallLine[]): Array<{ text: string; cls: string; color: string }> {
  return lines.concat(lines).map((l) => ({ text: l.t, cls: l.m ? 'tv-missed' : '', color: l.m ? '#FFD9C9' : '#9C9389' }));
}

/** The marquee: each row twice, coloured in a repeating muted / accent / text pattern. */
export function marq(items: string[]): Array<{ t: string; color: string }> {
  return items.concat(items).map((t, i) => ({ t, color: i % 3 === 1 ? '#E8643A' : (i % 3 === 2 ? '#F2EDE4' : '#7D736A') }));
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
