/**
 * [P81-B · owner, 21 Nov] The accuracy test: the 2,000-message synthetic chat in plan/accuracy-test/, scored against
 * its answer key by the rules in plan/accuracy-test/README.md. Fictional people, so outputs are kept and may be committed.
 *
 *   One command, extract + score (Message Batches API, half price; needs ANTHROPIC_API_KEY, the eval key):
 *     npx tsx scripts/eval/accuracy-test.ts run --label v097 --runs 2 [--cap 10] [--size 200] [--src apps/api/src] [--profile v010]
 *   Score saved outputs again (free):
 *     npx tsx scripts/eval/accuracy-test.ts score plan/accuracy-test/runs/v097-1.json plan/accuracy-test/runs/v097-2.json
 *
 * The run goes through the production extraction path (createExtractionService: windowed, the pre-filter if the source
 * tree has it, the deterministic checks and date resolver) with the model calls captured, sent as ONE batch, and the
 * answers replayed through the same service, so the stored extraction is exactly what production stores. --src points
 * at another source tree (a worktree) to score a draft; --profile v010 selects that tree's v0.10 prompt profile.
 *
 * Scoring (README): recall by difficulty and field (a row is found when an item in its field, or an equally valid one,
 * carries the row's message as its receipt, or states its meaning); dates (correct / null as it should be / wrong);
 * updates (X01 replaces O02, M19 updates O01, O18 is the meeting kept); trap violations (must be 0); items that match no
 * row (with whether their quote and timestamp are in the chat); agreement between runs; AED, pieces, thinking per piece.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, basename } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const DIR = `${ROOT}/plan/accuracy-test`;
const ZIP = `${DIR}/WhatsApp Chat - Layla Haddad.zip`;
const CLIENT = 'Layla Haddad';
const REP = 'Sam Karimi';
const TODAY = '2026-11-21';

type Obj = Record<string, unknown>;
type Extraction = Obj & { promises?: Obj[]; people?: Obj[]; personal_facts?: Obj[]; key_dates?: Obj[]; requirements?: Obj[]; concerns?: string[]; next_steps?: string[]; meeting?: Obj | null; budget?: Obj[]; decision_process?: Obj[]; situation?: Obj[] };
interface Row { id: string; difficulty: string; msg_number: string; timestamp: string; sender: string; message_text: string; 'field_v0.9.7': string; 'field_v0.10': string; expected: string; expected_date: string; date_raw: string; must_not_store: string; notes: string }
interface RunFile { meta: { label: string; run: number; size?: number; prompt: string; prefilter: string; pieces: number; calls: number; failedCalls: number; aed: number; thinkingPerPiece: number; thinkingMax: number; batchSeconds: number }; extracted: Extraction | null }

// ── the key ────────────────────────────────────────────────────────────────────────────────────────────────────────
function parseCsv(text: string): Row[] {
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; continue; }
    if (ch === '"') q = true; else if (ch === ',') { row.push(cell); cell = ''; } else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; } else if (ch !== '\r') cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.some((c) => c.trim()));
  return body.map((r) => Object.fromEntries(head!.map((h, i) => [h, r[i] ?? ''])) as unknown as Row);
}
const KEY = parseCsv(readFileSync(`${DIR}/answer-key.csv`, 'utf8'));

/**
 * How each row is recognised. `fields`: where it may be stored (the key's field first, then equally valid ones);
 * `means`: the meaning, as a pattern over the item's text (used when the item has no matching receipt). `owner` for
 * promises. Superseded rows (O06) are scored under updates, not recall.
 */
const PF = ['personal_facts'], RQ = ['requirements'];
const M: Record<string, { fields: string[]; means: RegExp; owner?: 'rep' | 'client'; superseded?: true }> = {
  O01: { fields: ['budget', ...RQ, ...PF, 'situation', 'concerns', 'next_steps'], means: /3\.5/ },
  O02: { fields: [...RQ, ...PF], means: /\b(3|4|three|four)[- ]?(bed|br)/i },
  O03: { fields: ['promises'], means: /floor ?plan/i, owner: 'rep' },
  O04: { fields: ['people', 'decision_process'], means: /karim|husband/i },
  O05: { fields: [...PF, ...RQ], means: /beach/i },
  O06: { fields: ['meeting'], means: /14 march|2026-03-14/i, superseded: true },
  O07: { fields: ['promises'], means: /pre-?approval|mortgage/i, owner: 'client' },
  M01: { fields: [...RQ, ...PF], means: /\bpool\b/i },
  O08: { fields: [...PF, 'people'], means: /adam|noor|kids|children/i },
  O09: { fields: ['concerns'], means: /service charge/i },
  O10: { fields: RQ, means: /parking/i },
  X07: { fields: ['key_dates'], means: /renewal|notice/i },
  O11: { fields: ['key_dates'], means: /lease (end|expir)|lease ends|30 june/i },
  O12: { fields: ['promises'], means: /payment plan|developer/i, owner: 'rep' },
  O13: { fields: RQ, means: /off-?plan|ready to move/i },
  O14: { fields: [...RQ, ...PF], means: /study/i },
  O15: { fields: [...PF, 'situation'], means: /dentist|clinic/i },
  M02: { fields: RQ, means: /ground[- ]floor/i },
  X02: { fields: [...RQ, ...PF], means: /cook/i },
  M03: { fields: ['key_dates', 'situation', ...PF, 'next_steps', 'budget', 'promises'], means: /bonus|down payment/i },
  O16: { fields: [...RQ, ...PF], means: /20th|high floor/i },
  M04: { fields: PF, means: /football/i },
  M05: { fields: ['concerns'], means: /handover|late|delay/i },
  X03: { fields: [...PF, ...RQ], means: /beige/i },
  M06: { fields: ['promises'], means: /snagging/i, owner: 'rep' },
  O17: { fields: ['next_steps', 'promises', ...RQ], means: /arabian ranches/i },
  M07: { fields: ['promises', 'next_steps'], means: /bank.*(approv|sign)|sign.*bank/i },
  M08: { fields: ['next_steps', 'key_dates', 'promises'], means: /\beid\b/i },
  M09: { fields: ['next_steps'], means: /rania|sister/i },
  X04: { fields: [...RQ, ...PF], means: /crowd|busy|quiet area|za7ma/i },
  M10: { fields: [...RQ, ...PF], means: /airport/i },
  M11: { fields: [...PF, 'situation', 'budget', 'concerns'], means: /180/i },
  M12: { fields: ['key_dates', ...PF], means: /kg2|school/i },
  X05: { fields: ['concerns', 'decision_process', ...PF, 'next_steps', 'budget'], means: /\bdad\b|father/i },
  X06: { fields: ['promises'], means: /valuation/i, owner: 'client' },
  M13: { fields: ['promises'], means: /landlord/i, owner: 'rep' },
  M14: { fields: ['concerns'], means: /another agent|other agent|agent/i },
  M15: { fields: [...PF, ...RQ, 'concerns'], means: /dark|natural light|light/i },
  X08: { fields: ['concerns', ...RQ, ...PF], means: /highway|noise|truck|quiet/i },
  M16: { fields: RQ, means: /\bgym\b/i },
  M17: { fields: ['key_dates', ...PF], means: /60th|60|mum|mother/i }, // a personal fact keeping the birthday is an equally valid field (no date to store: it has no year)
  X09: { fields: PF, means: /aquarium/i },
  M18: { fields: ['key_dates', ...RQ], means: /clos|1 september|september 2026/i },
  M19: { fields: ['budget', ...RQ, ...PF], means: /3\.8/ },
  M20: { fields: ['promises'], means: /broker/i, owner: 'rep' },
  X10: { fields: ['concerns', 'key_dates', ...PF, 'situation'], means: /contract/i },
  X11: { fields: [...RQ, 'concerns'], means: /shade/i },
  X01: { fields: RQ, means: /\b(4|four)[- ]?(bed|br)/i },
  X12: { fields: [...PF, ...RQ], means: /mishmish|\bcat\b|balcony/i },
  X13: { fields: RQ, means: /studio/i },
  X14: { fields: ['key_dates'], means: /away|december/i },
  X15: { fields: ['promises'], means: /pool depth|service charge history|second viewing/i, owner: 'rep' },
  X16: { fields: ['key_dates', ...PF], means: /karim.*birthday|birthday.*karim|14 may|anniversary/i }, // as personal facts is an equally valid field (the dates have no year)
  O18: { fields: ['meeting'], means: /12 november|2026-11-12|thursday/i },
};
/** Each trap, as what would violate it, checked over everything stored. */
const TRAPS: Record<string, (e: Extraction, all: string) => boolean> = {
  N01: (_e, all) => /surgery|knee|six weeks/i.test(all),
  N02: (_e, all) => /umrah/i.test(all),
  N03: (_e, all) => /784[- ]?1988|1234567/.test(all),
  N04: (e) => /universit/i.test(anywhereBut(e, [])), // the rep's own fact, in any field
  // [owner, 21 Nov] a violation only as a requirement or a promise; a (low-confidence) next step, or a personal fact, is not
  N05: (e) => [...items(e, 'requirements'), ...items(e, 'promises')].some((x) => /spain/i.test(text(x))),
  N06: (e) => items(e, 'requirements').some((x) => /colleague/i.test(text(x))) || items(e, 'people').some((x) => /colleague/i.test(text(x))),
  N07: (e) => storedDates(e).some((d) => d.date !== null && /05\/06/.test(d.raw ?? '')),
  N08: (e) => items(e, 'requirements').some((x) => /jvc/i.test(text(x))),
  // a budget or requirement of 5M (not the "5M" inside "3.5M"; a concern recording the joke is not a budget)
  N09: (e) => [...items(e, 'budget'), ...items(e, 'requirements')].some((x) => /(?<![\d.])5 ?m\b|5,000,000|5 million/i.test(text(x))),
  N10: (_e, all) => /pregnan|expecting|baby/i.test(all),
  N11: (_e, all) => /blood pressure/i.test(all),
  N12: (e) => items(e, 'promises').some((x) => /decide/i.test(text(x)) && x.confidence === 'high') || storedDates(e).some((d) => d.date === '2026-12-31'),
};

// ── reading an extraction ──────────────────────────────────────────────────────────────────────────────────────────
const wrapped = new WeakMap<object, Obj[]>();
/** A field's items as objects (a concern or next step string becomes { text }), the same objects on every read. */
function items(e: Extraction | null, field: string): Obj[] {
  if (!e) return [];
  if (field === 'meeting') return e.meeting ? [e.meeting] : [];
  const v = e[field];
  if (!Array.isArray(v)) return [];
  const hit = wrapped.get(v);
  if (hit) return hit;
  const out = v.map((x) => (typeof x === 'string' ? { text: x } : (x as Obj)));
  wrapped.set(v, out);
  return out;
}
/** Every stored item except those in the allowed fields, as text (for a trap that may appear only there). */
const anywhereBut = (e: Extraction, allowed: string[]): string => FIELDS.filter((f) => !allowed.includes(f)).flatMap((f) => items(e, f).map(text)).join(' || ') + ' || ' + String(e.summary ?? '');
const text = (x: Obj): string => Object.entries(x).filter(([k, v]) => typeof v === 'string' && !k.endsWith('_at') && k !== 'confidence').map(([, v]) => v).join(' | ');
const minute = (ts: string): string => ts.replace(' ', 'T').slice(0, 16);
const FIELDS = ['promises', 'meeting', 'key_dates', 'requirements', 'budget', 'decision_process', 'concerns', 'personal_facts', 'situation', 'next_steps', 'people'];

let dateLib: { trustedPromiseDate: (p: Obj, o: { dayFirst: boolean }) => { date: string | null }; trustedKeyDate: (k: Obj, o: { dayFirst: boolean }) => { date: string | null }; trustedMeetingDatetime: (m: Obj, o: { dayFirst: boolean }) => string | null } | null = null;
/** The date Tovira stores for each dated item (the same date policy the facts write uses). */
function storedDates(e: Extraction | null): Array<{ field: string; item: Obj; date: string | null; raw: string | null }> {
  if (!e || !dateLib) return [];
  const o = { dayFirst: true };
  return [
    ...items(e, 'promises').map((p) => ({ field: 'promises', item: p, date: dateLib!.trustedPromiseDate(p, o).date, raw: (p.due_raw as string) ?? null })),
    ...items(e, 'key_dates').map((k) => ({ field: 'key_dates', item: k, date: dateLib!.trustedKeyDate(k, o).date, raw: (k.date_raw as string) ?? null })),
    ...items(e, 'meeting').map((m) => ({ field: 'meeting', item: m, date: dateLib!.trustedMeetingDatetime(m, o), raw: (m.datetime_raw as string) ?? null })),
  ];
}

function rowMatches(row: Row, x: Obj, field: string): boolean {
  const m = M[row.id]!;
  if (!m.fields.includes(field)) return false;
  if (m.owner && field === 'promises' && x.owner !== m.owner) return false;
  const at = typeof x.source_message_at === 'string' ? minute(x.source_message_at) : null;
  if (at && at === minute(row.timestamp)) return true; // its receipt is the row's message
  const raw = typeof x.requirement_raw === 'string' ? x.requirement_raw.toLowerCase().trim() : '';
  if (raw && row.message_text.toLowerCase().includes(raw)) return true; // a v0.9.7 requirement quotes the row's words
  if (field === 'meeting') return m.means.test(`${text(x)} ${String(storedDates({ meeting: x } as Extraction)[0]?.date ?? '')}`);
  return m.means.test(text(x)) && (!at || Math.abs(Date.parse(at) - Date.parse(minute(row.timestamp))) < 3 * 86_400_000); // a receipt elsewhere in time is another statement
}

interface Score {
  found: Record<string, boolean>; byDifficulty: Record<string, string>; byField: Record<string, string>;
  dates: Array<{ id: string; expected: string | null; stored: string | null | undefined; verdict: 'correct' | 'null_as_it_should_be' | 'null_but_a_date_was_expected' | 'wrong_date' | 'item_missing' }>;
  updates: Record<string, boolean>; traps: string[]; unmatched: Array<{ field: string; text: string; quoteInChat: boolean | null; timeInChat: boolean | null }>;
  x15: string; x16: string;
}
function score(e: Extraction | null, version: 'v0.9.7' | 'v0.10', chat: { text: string; stamps: Set<string> }): Score {
  const fieldCol = version === 'v0.10' ? 'field_v0.10' : 'field_v0.9.7';
  const recallRows = KEY.filter((r) => M[r.id] && !M[r.id]!.superseded);
  const found: Record<string, boolean> = {};
  const used = new Set<Obj>();
  for (const r of KEY.filter((k) => M[k.id])) {
    const hits = FIELDS.flatMap((f) => items(e, f).filter((x) => rowMatches(r, x, f)));
    found[r.id] = hits.length > 0;
    for (const h of hits) used.add(h);
  }
  const tally = (by: (r: Row) => string) => {
    const t: Record<string, [number, number]> = {};
    for (const r of recallRows) { const k = by(r); t[k] ??= [0, 0]; t[k]![1]++; if (found[r.id]) t[k]![0]++; }
    return Object.fromEntries(Object.entries(t).map(([k, [a, b]]) => [k, `${a}/${b}`]));
  };
  const sd = storedDates(e);
  const dates: Score['dates'] = [];
  for (const r of KEY.filter((k) => M[k.id] && (k.expected_date || k.date_raw || k.id === 'O18'))) {
    const expected = r.id === 'O18' ? '2026-11-12T16:00' : (r.expected_date || null);
    const hit = sd.find((d) => rowMatches(r, d.item, d.field));
    let verdict: Score['dates'][number]['verdict'];
    if (!hit && !found[r.id]) verdict = 'item_missing';
    else if (!hit) verdict = expected === null ? 'null_as_it_should_be' : 'null_but_a_date_was_expected'; // found, in a field that holds no date
    else if (expected === null) verdict = hit.date === null ? 'null_as_it_should_be' : 'wrong_date';
    else if (hit.date === null) verdict = 'null_but_a_date_was_expected';
    else verdict = hit.date.slice(0, expected.length) === expected ? 'correct' : 'wrong_date';
    dates.push({ id: r.id, expected, stored: hit?.date, verdict });
  }
  const reqs = items(e, 'requirements').map(text).join(' || ');
  const all = JSON.stringify(e ?? {});
  const updates = {
    'X01 replaces O02 (4 bedrooms stored, no current 3-bedroom need)': /\b(4|four)[- ]?(bed|br)/i.test(reqs) && !/\b(3|three)[- ]?(bed|br)/i.test(reqs.replace(/not 3|instead of 3|from 3|3 to 4|3 → 4|rather than 3/gi, '')),
    'M19 updates O01 (the 3.8 stretch stored)': /3\.8/.test([...items(e, 'budget'), ...items(e, 'requirements'), ...items(e, 'personal_facts')].map(text).join(' ')),
    'O18 is the meeting kept (12 Nov 16:00)': (storedDates(e).find((d) => d.field === 'meeting')?.date ?? '').startsWith('2026-11-12T16:00'),
  };
  const traps = Object.entries(TRAPS).filter(([, f]) => e && f(e, all)).map(([id]) => id);
  const unmatched = FIELDS.flatMap((f) => items(e, f).filter((x) => !used.has(x)).map((x) => ({
    field: f, text: text(x).slice(0, 160),
    quoteInChat: typeof x.source_span === 'string' ? chat.text.includes(x.source_span.replace(/\s+/g, ' ').trim()) : null,
    timeInChat: typeof x.source_message_at === 'string' ? chat.stamps.has(minute(x.source_message_at)) : null,
  })));
  const x15 = ['pool depth', 'service charge history|3 years|three years', 'second viewing'].filter((p) => items(e, 'promises').some((x) => new RegExp(p, 'i').test(text(x)))).length;
  const x16 = [/karim.*birthday|birthday.*karim/i, /anniversary/i].filter((p) => items(e, 'key_dates').some((x) => p.test(text(x)))).length;
  return { found, byDifficulty: tally((r) => r.difficulty), byField: tally((r) => r[fieldCol as keyof Row] as string), dates, updates, traps, unmatched, x15: `${x15}/3 promises`, x16: `${x16}/2 dates` };
}

// ── running the production path through one batch ──────────────────────────────────────────────────────────────────
async function run(args: Map<string, string>): Promise<string[]> {
  const SRC = resolve(ROOT, args.get('src') ?? 'apps/api/src');
  const label = args.get('label') ?? 'run';
  const runs = Number(args.get('runs') ?? '1');
  const cap = Number(args.get('cap') ?? '10');
  const KEYV = process.env.ANTHROPIC_API_KEY;
  if (!KEYV) throw new Error('ANTHROPIC_API_KEY (the eval key) is required');
  const imp = (p: string) => import(`${SRC}/${p}`);
  const { listZipEntries, readZipTextEntry } = await imp('services/import/zip.ts');
  const { parseWhatsAppExport } = await imp('services/import/whatsapp.ts');
  const { redactMessages } = await imp('services/redaction/redact.ts');
  const { screenPrecise } = await imp('services/screening/precise-screen.ts');
  const { assignSpeakerRoles } = await imp('services/import/unanswered.ts');
  const { renderThread } = await imp('services/import/dedup.ts');
  const { loadConfig } = await imp('config.ts');
  const c = await imp('container.ts');
  const { InMemoryClientRepository } = await imp('adapters/clients/in-memory-client-repository.ts');
  const { InMemoryNoteRepository } = await imp('adapters/notes/in-memory-note-repository.ts');
  const { InMemoryFactsRepository } = await imp('adapters/facts/in-memory-facts-repository.ts');
  const { InMemoryExtractionLogRepository } = await imp('adapters/logs/in-memory-extraction-log-repository.ts');
  const { AI_PRICES, USD_TO_AED } = await imp('services/spend/ai-prices.ts');
  const { PROMPT_VERSION } = await imp('services/extraction/prompt.ts');
  const profile = args.get('profile') === 'v010' ? (await imp('services/extraction/prompt-profile.ts')).PROMPT_V010_DRAFT : undefined;
  const hasPrefilter = existsSync(`${SRC}/services/import/chatter-filter.ts`) && (profile ? profile.prefilter : readFileSync(`${SRC}/services/extraction/extraction-service.ts`, 'utf8').includes('[P81-1'));
  // --size: the piece size (overlap stays 20); default the production setting
  const size = args.get('size') ? Number(args.get('size')) : undefined;
  const config = { ...loadConfig(), windowing: { ...loadConfig().windowing, enabled: true, ...(size ? { size, overlap: 20 } : {}) } };
  const P = AI_PRICES.anthropic[config.anthropicModel];
  const aed = (u: Obj) => 0.5 * USD_TO_AED * (((u.input_tokens as number) ?? 0) * P.inputPerMTok + ((u.output_tokens as number) ?? 0) * P.outputPerMTok + ((u.cache_read_input_tokens as number) ?? 0) * P.cacheReadPerMTok + ((u.cache_creation_input_tokens as number) ?? 0) * P.cacheWritePerMTok) / 1e6;

  const buf = readFileSync(ZIP);
  const dir = listZipEntries(buf, 10); if (!dir.ok) throw new Error('zip');
  const chatText = readZipTextEntry(buf, dir.entries.find((e: { name: string }) => e.name === '_chat.txt')!, 40_000_000) as string;
  const parsed = parseWhatsAppExport(chatText); if (!parsed.ok) throw new Error('parse');
  const realFetch = globalThis.fetch;
  let transport: (body: Obj) => Promise<Response> = async () => { throw new Error('no transport'); };
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.includes('/v1/messages')) return realFetch(input, init);
    return transport(JSON.parse(String(init!.body)));
  }) as typeof fetch;
  const hash = (b: Obj) => createHash('sha1').update(JSON.stringify([b.system, b.messages])).digest('hex');
  const extractOnce = async () => {
    const msgs = redactMessages(parsed.messages).messages.map((m: { body: string }) => { const f = screenPrecise(m.body); return { ...m, ...(f.length ? { sensitive: f, excluded: true } : {}) }; });
    const clients = new InMemoryClientRepository(); const notes = new InMemoryNoteRepository();
    const svc = c.createExtractionService(config, clients, notes, new InMemoryFactsRepository(), new InMemoryExtractionLogRepository(), undefined, c.createExtractionModelRouter(config, async () => 'active'),
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, ...(profile ? [profile] : []));
    const client = await clients.create('acc', CLIENT);
    const messages = assignSpeakerRoles(msgs, CLIENT, { aliases: [], repName: REP });
    const note = await notes.create('acc', { clientId: client.id, source: 'whatsapp_export', rawText: renderThread(messages), audioKey: null, status: 'pending_extraction', messages });
    await notes.claimForExtraction('acc', note.id, Date.now());
    await svc.extractNote('acc', note.id, TODAY, { forceAllowance: true });
    return (await notes.findByIdForUser('acc', note.id))?.extracted ?? null;
  };
  // 1. capture (free)
  const captured: Obj[] = [];
  transport = async (b) => { captured.push(b); return new Response(JSON.stringify({ content: [{ type: 'text', text: '{"summary":"","promises":[],"people":[],"personal_facts":[],"key_dates":[],"concerns":[],"next_steps":[],"requirements":[],"meeting":null}' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200 }); };
  await extractOnce();
  const pieces = captured.length;
  // The cap covers every run recorded in runs/spend.json (one test round); estimate at the measured batch price per piece.
  const ledgerFile = `${DIR}/runs/spend.json`;
  const ledger = existsSync(ledgerFile) ? (JSON.parse(readFileSync(ledgerFile, 'utf8')) as { spentAed: number; runs: Array<{ label: string; aed: number }> }) : { spentAed: 0, runs: [] };
  const estimate = pieces * runs * 0.18; // AED at batch price (measured 0.16-0.18 per 120-message piece, 19-21 Nov)
  console.log(`${label}: ${pieces} pieces per run · ${runs} run(s) · prompt ${profile?.version ?? PROMPT_VERSION} · pre-filter ${hasPrefilter ? 'on' : 'off'} · estimate AED ${estimate.toFixed(2)} · already spent AED ${ledger.spentAed.toFixed(2)} of cap ${cap}`);
  if (ledger.spentAed + estimate > cap) throw new Error(`AED ${ledger.spentAed.toFixed(2)} spent + estimate ${estimate.toFixed(2)} is over the cap AED ${cap}: nothing sent`);
  // 2. one batch for every run
  const headers = { 'content-type': 'application/json', 'x-api-key': KEYV, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'extended-cache-ttl-2025-04-11' };
  const t0 = Date.now();
  const requests = Array.from({ length: runs }, (_, r) => captured.map((b, i) => ({ custom_id: `r${r}-p${i}`, params: b }))).flat();
  const sub = await realFetch('https://api.anthropic.com/v1/messages/batches', { method: 'POST', headers, body: JSON.stringify({ requests }) });
  const batch = (await sub.json()) as { id?: string };
  if (!sub.ok || !batch.id) throw new Error(`batch submit failed (${sub.status})`);
  console.log(`submitted ${requests.length} requests as ${batch.id}`);
  let st: { ended_at?: string | null; results_url?: string | null; request_counts?: Obj } = {};
  while (!st.ended_at) { await new Promise((r) => setTimeout(r, 20_000)); st = (await (await realFetch(`https://api.anthropic.com/v1/messages/batches/${batch.id}`, { headers })).json()) as typeof st; console.log(`+${Math.round((Date.now() - t0) / 1000)}s ${JSON.stringify(st.request_counts)}`); }
  const results = new Map<string, { type: string; message?: Obj & { usage?: Obj } }>();
  for (const line of (await (await realFetch(st.results_url!, { headers })).text()).split('\n').filter(Boolean)) { const r = JSON.parse(line) as { custom_id: string; result: { type: string; message?: Obj } }; results.set(r.custom_id, r.result); }
  // 3. replay each run through the same service
  mkdirSync(`${DIR}/runs`, { recursive: true });
  const files: string[] = [];
  for (let r = 0; r < runs; r++) {
    const byHash = new Map<string, { type: string; message?: Obj & { usage?: Obj } }>();
    captured.forEach((b, i) => byHash.set(hash(b), results.get(`r${r}-p${i}`)!));
    const usages = [...byHash.values()].map((x) => x.message?.usage ?? {});
    let calls = 0, failed = 0;
    transport = async (b) => {
      calls++;
      const x = byHash.get(hash(b));
      if (!x || x.type !== 'succeeded') { failed++; return new Response(JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'batch item failed' } }), { status: 500 }); }
      return new Response(JSON.stringify(x.message), { status: 200 });
    };
    const extracted = await extractOnce();
    const think = usages.map((u) => ((u.output_tokens_details as Obj | undefined)?.thinking_tokens as number) ?? 0);
    const out: RunFile = { meta: { label, run: r + 1, size: config.windowing.size, prompt: profile?.version ?? PROMPT_VERSION, prefilter: hasPrefilter ? 'on' : 'off', pieces, calls, failedCalls: failed, aed: +usages.reduce((n, u) => n + aed(u), 0).toFixed(3), thinkingPerPiece: Math.round(think.reduce((a, b) => a + b, 0) / Math.max(1, think.length)), thinkingMax: Math.max(0, ...think), batchSeconds: Math.round((Date.now() - t0) / 1000) }, extracted: extracted as Extraction | null };
    const f = `${DIR}/runs/${label}-${r + 1}.json`;
    writeFileSync(f, JSON.stringify(out, null, 1));
    files.push(f);
    ledger.spentAed += out.meta.aed; ledger.runs.push({ label: `${label}-${r + 1}`, aed: out.meta.aed });
    writeFileSync(ledgerFile, JSON.stringify(ledger, null, 1));
  }
  dateLib = await imp('services/extraction/date-policy.ts');
  return files;
}

// ── report ─────────────────────────────────────────────────────────────────────────────────────────────────────────
async function report(files: string[], src: string): Promise<void> {
  dateLib ??= await import(`${resolve(ROOT, src)}/services/extraction/date-policy.ts`);
  const chatLines = readFileSync(`${DIR}/runs/.chat-cache.txt`, 'utf8');
  const chat = { text: chatLines.replace(/\s+/g, ' '), stamps: new Set(chatLines.split('\n').map((l) => /^\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/.exec(l)?.[1]).filter((x): x is string => !!x)) };
  const loaded = files.map((f) => JSON.parse(readFileSync(f, 'utf8')) as RunFile);
  const scored = loaded.map((r) => ({ r, s: score(r.extracted, r.meta.prompt.includes('0.10') ? 'v0.10' : 'v0.9.7', chat) }));
  const lines: string[] = [];
  for (const { r, s } of scored) {
    const total = Object.values(s.found).length - 1; // O06 superseded
    const got = Object.entries(s.found).filter(([id, v]) => v && !M[id]!.superseded).length;
    const d = (v: string) => s.dates.filter((x) => x.verdict === v).length;
    lines.push(`## ${r.meta.label} run ${r.meta.run} (${r.meta.prompt}, pre-filter ${r.meta.prefilter}, pieces of ${r.meta.size ?? 120})`,
      `- AED ${r.meta.aed} (batch price) · ${r.meta.pieces} pieces · thinking per piece ${r.meta.thinkingPerPiece} (max ${r.meta.thinkingMax}) · failed calls ${r.meta.failedCalls}`,
      `- Recall ${got}/${total} = ${Math.round((got / total) * 100)}% · by difficulty ${JSON.stringify(s.byDifficulty)}`,
      `- By field ${JSON.stringify(s.byField)}`,
      `- Dates (${s.dates.length} dated rows): correct ${d('correct')}, null as it should be ${d('null_as_it_should_be')}, wrong date ${d('wrong_date')}, null where a date was expected ${d('null_but_a_date_was_expected')}, item not stored ${d('item_missing')}`,
      ...s.dates.filter((x) => x.verdict !== 'correct' && x.verdict !== 'null_as_it_should_be').map((x) => `  - ${x.id}: ${x.verdict.replace(/_/g, ' ')} (stored ${x.stored ?? 'null'}, expected ${x.expected ?? 'null'})`),
      `- Updates: ${Object.entries(s.updates).map(([k, v]) => `${v ? 'PASS' : 'FAIL'} ${k}`).join('; ')}`,
      `- X15 ${s.x15}; X16 ${s.x16}`,
      `- Trap violations: ${s.traps.length ? s.traps.join(', ') : 'none'}`,
      `- Missed: ${Object.entries(s.found).filter(([id, v]) => !v && !M[id]!.superseded).map(([id]) => id).join(', ') || 'none'}`,
      `- Items matching no key row: ${s.unmatched.length} (quote not in chat: ${s.unmatched.filter((u) => u.quoteInChat === false).length}, timestamp not in chat: ${s.unmatched.filter((u) => u.timeInChat === false).length})`,
      ...s.unmatched.map((u) => `  - ${u.field}: ${u.text}${u.quoteInChat === false ? ' [QUOTE NOT IN CHAT]' : ''}${u.timeInChat === false ? ' [TIME NOT IN CHAT]' : ''}`), '');
  }
  // agreement between runs of the same label
  const byLabel = new Map<string, typeof scored>();
  for (const x of scored) byLabel.set(x.r.meta.label, [...(byLabel.get(x.r.meta.label) ?? []), x]);
  for (const [label, xs] of byLabel) {
    if (xs.length < 2) continue;
    const ids = Object.keys(xs[0]!.s.found).filter((id) => !M[id]!.superseded);
    const both = ids.filter((id) => xs.every((x) => x.s.found[id])).length;
    const either = ids.filter((id) => xs.some((x) => x.s.found[id])).length;
    lines.push(`## ${label}: agreement between runs`, `- Found by both ${both}, by either ${either}: ${Math.round((both / Math.max(1, either)) * 100)}% agree`, `- Found by only one run: ${ids.filter((id) => xs.some((x) => x.s.found[id]) && !xs.every((x) => x.s.found[id])).join(', ') || 'none'}`, '');
  }
  const missedAll = Object.keys(scored[0]?.s.found ?? {}).filter((id) => !M[id]!.superseded && scored.every((x) => !x.s.found[id]));
  lines.push(`## Missed by every run`, `- ${missedAll.map((id) => `${id} (${KEY.find((k) => k.id === id)!.difficulty}: ${KEY.find((k) => k.id === id)!.expected})`).join('\n- ') || 'none'}`);
  const md = lines.join('\n');
  writeFileSync(`${DIR}/runs/report-${[...byLabel.keys()].join('-')}.md`, md);
  console.log(md);
}

// ── cli ────────────────────────────────────────────────────────────────────────────────────────────────────────────
const [cmd, ...rest] = process.argv.slice(2);
const args = new Map<string, string>();
const paths: string[] = [];
for (let i = 0; i < rest.length; i++) { if (rest[i]!.startsWith('--')) { args.set(rest[i]!.slice(2), rest[i + 1] ?? ''); i++; } else paths.push(rest[i]!); }
async function chatCache(src: string): Promise<void> {
  mkdirSync(`${DIR}/runs`, { recursive: true });
  const imp = (p: string) => import(`${resolve(ROOT, src)}/${p}`);
  const { listZipEntries, readZipTextEntry } = await imp('services/import/zip.ts');
  const { parseWhatsAppExport } = await imp('services/import/whatsapp.ts');
  const { redactMessages } = await imp('services/redaction/redact.ts');
  const { renderThread } = await imp('services/import/dedup.ts');
  const buf = readFileSync(ZIP); const dir = listZipEntries(buf, 10); if (!dir.ok) throw new Error('zip');
  const p = parseWhatsAppExport(readZipTextEntry(buf, dir.entries.find((e: { name: string }) => e.name === '_chat.txt')!, 40_000_000) as string);
  writeFileSync(`${DIR}/runs/.chat-cache.txt`, renderThread(redactMessages(p.messages).messages));
}
const src = args.get('src') ?? 'apps/api/src';
if (cmd === 'run') { await chatCache(src); const files = await run(args); await report(files, src); }
else if (cmd === 'score') { await chatCache(src); await report(paths.map((p) => resolve(p)), src); }
else { console.log(`usage:\n  npx tsx scripts/eval/accuracy-test.ts run --label <name> --runs <n> [--cap AED] [--size N] [--src <tree>/apps/api/src] [--profile v010]\n  npx tsx scripts/eval/accuracy-test.ts score <run.json>...`); process.exitCode = 2; }
void basename;
