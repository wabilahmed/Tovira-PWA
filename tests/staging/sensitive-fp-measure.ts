/**
 * [SCREEN-FP] Flag-cost measurement for the sensitive screen on a representative "hard import".
 *
 * There is no committed copy of the original 317-flags corpus (the committed synthetic export is
 * content-free — "msg N about the deal"), so this is a FIXED, deterministic corpus of Dubai
 * real-estate chat shaped to exercise the routine register that drives false positives (government
 * fees, golden-visa/immigration, demographic descriptors, amenities like a prayer room / medical
 * centre, church & temple landmarks) alongside genuinely sensitive lines (true positives). The
 * absolute totals are NOT claimed to equal 317; the baseline is the prior-commit number on THIS
 * corpus, and before/after/after-narrowing are all measured on it, so the comparison is apples-to-apples.
 *
 * Usage:  npx tsx tests/staging/sensitive-fp-measure.ts [path-to-sensitive-screen-module]
 *   default module = the working-tree screen.
 */
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const HARD_IMPORT_REPEAT = 15; // repeat the template block → ~1,650 messages (a hard import)

// — ordinary real-estate chat: NO sensitive register. The bulk of a real import. —
const ORDINARY = [
  'can you send the floor plan for unit 1204', 'the asking price is 2.4m, slightly negotiable',
  'service charge is 18 per sqft this year', 'handover is Q3 next year, Oqood already issued',
  'we can do the viewing Saturday at 11', 'DLD fee is 4% plus the trustee office charges',
  'Ejari needs renewing before the tenancy rolls over', 'the chiller is district cooling, Empower',
  'mortgage pre-approval came through from Emirates NBD', 'down payment is 20%, rest on handover',
  'NOC from the developer takes about five working days', 'title deed is ready for transfer',
  'the view is Marina-facing, high floor', 'JVC two-bed, upgraded kitchen, vacant on transfer',
  'Damac is offering a payment plan, 1% monthly', 'Emaar launch next week, register for early access',
  'the cheque cleared, we can proceed to transfer', 'snagging list is short, just the AC vents',
  'rent is 95k, one cheque, agent fee 5%', 'parking is two allocated bays in the basement',
  'the landlord wants four cheques, not one', 'maintenance is covered for the first year',
  'send me the trakheesi permit for the ad', 'the unit is tenanted till March, 70k',
  'balcony faces the pool, afternoon sun', 'completion is 60% so escrow protects the payments',
];

// — the routine register that over-flags (the owner's list + close variants) —
const FP_PRONE = [
  'the government fee for the transfer is separate', 'there is a government transfer fee on top',
  'he is applying for the golden visa this month', 'client had an immigration question about the visa',
  'it is an expat-friendly community, very social', 'the villa is near the Indian school in Oud Metha',
  'we are seeing a lot of European buyers lately', 'mostly Asian buyers for this tower',
  'a few African clients asked about the payment plan', 'the Egyptian investor wants two units',
  'the Pakistani tenant renewed for another year', 'it has a Filipino maid room off the kitchen',
  'the bank sanctioned the loan yesterday', 'there is a prayer room on every floor',
  'a medical centre nearby, two minutes walk', 'meet me at the church roundabout in Jebel Ali',
  'the temple down the road draws weekend traffic', 'government services are all on the app now',
  'voting day traffic was heavy near the villa', 'lots of expat families in that community',
];

// — genuinely sensitive lines (TRUE positives that must stay flagged) —
const TRUE_POSITIVE = [
  'he is recovering from surgery so push the viewing a week', 'she starts chemotherapy next week, be gentle',
  'he was arrested last year, it may show on checks', 'they are divorcing after his affair came out',
  'he is a devout Muslim and prays five times a day', 'she is pregnant with twins, wants a ground floor',
  'he is diabetic so the clinic location matters to him', 'his immigrant status is still pending, cash buyer',
  'she was diagnosed recently and needs a quiet floor', 'he is in hospital this week, call next Monday',
];

export function buildHardImport(): string[] {
  const block = [...ORDINARY, ...FP_PRONE, ...TRUE_POSITIVE];
  const out: string[] = [];
  for (let r = 0; r < HARD_IMPORT_REPEAT; r++) out.push(...block);
  return out;
}

async function main(): Promise<void> {
  const arg = process.argv[2];
  const modUrl = arg ? pathToFileURL(resolve(arg)).href : new URL('../../apps/api/src/services/screening/sensitive-screen.ts', import.meta.url).href;
  const { screenSensitive, SENSITIVE_CATEGORIES } = (await import(modUrl)) as typeof import('../../apps/api/src/services/screening/sensitive-screen.js');

  const corpus = buildHardImport();
  const perCat: Record<string, number> = Object.fromEntries(SENSITIVE_CATEGORIES.map((c) => [c, 0]));
  let total = 0;
  const bySpan = new Map<string, { category: string; count: number; examples: string[] }>();
  for (const msg of corpus) {
    for (const m of screenSensitive(msg)) {
      total += 1;
      perCat[m.category] = (perCat[m.category] ?? 0) + 1;
      const key = `${m.category}:${m.span.toLowerCase()}`;
      const e = bySpan.get(key) ?? { category: m.category, count: 0, examples: [] };
      e.count += 1;
      if (e.examples.length < 3 && !e.examples.includes(msg)) e.examples.push(msg);
      bySpan.set(key, e);
    }
  }

  console.log(`\n[screen-fp] module: ${arg ?? '(working tree)'} · corpus: ${corpus.length} messages`);
  console.log(`[screen-fp] TOTAL FLAGS: ${total}`);
  for (const c of SENSITIVE_CATEGORIES) console.log(`[screen-fp]   ${c}: ${perCat[c]}`);
  console.log(`[screen-fp] TOP 15 firing terms:`);
  const top = [...bySpan.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 15);
  for (const [key, e] of top) {
    console.log(`[screen-fp]   ${String(e.count).padStart(5)}  ${key}`);
    for (const ex of e.examples) console.log(`[screen-fp]            · ${ex}`);
  }
}

main().catch((err: unknown) => { console.error(err); process.exit(1); });
