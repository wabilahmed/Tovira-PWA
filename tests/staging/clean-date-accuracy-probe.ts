/**
 * [CLEAN-DATE-ACCURACY-PROBE] Report-only probe: how often does certified v0.9.5 resolve an
 * UNAMBIGUOUS date/time incorrectly? The time-ambiguity probe found the clean control
 * ("meeting Thursday 3pm") wrong on 1/5 — a single input at low N. This measures it at N.
 *
 * 25 inputs whose correct resolution is unambiguous, each embedded in a realistic UAE
 * real-estate/insurance exchange, run 20× against production v0.9.5 UNCHANGED = 500 calls.
 * Nothing is changed — no prompt, schema, gate, or fixture edits.
 *
 * FAITHFUL ANCHOR: production resolves an imported chat's relative dates against the LATEST
 * message's date (referenceDateFor), NOT the import/run date. This harness passes exactly that
 * date as `today` to buildUserMessage, and renders the thread as production renders it.
 *
 * GROUND TRUTH: each input states its expected resolution up front (below). Correctness is
 * mechanically checked, not judged. Relative inputs (D/F and G3/G4) carry an earlier decoy
 * message on a different date, so an ANCHOR error (resolved against the wrong reference) is
 * distinguishable from a RESOLUTION error (wrong arithmetic from the right reference).
 *
 *   bash -c 'set -a; source ./.env; set +a; : "${DATABASE_URL:=postgres://x:x@localhost:5432/x}"; \
 *     export DATABASE_URL; npx tsx tests/staging/clean-date-accuracy-probe.ts'
 */
import { writeFileSync } from 'node:fs';
import { loadConfig } from '../../apps/api/src/config.js';
import { createModelClient } from '../../apps/api/src/container.js';
import { EXTRACTION_SYSTEM_PROMPT, EXTRACTION_MAX_TOKENS, buildUserMessage, PROMPT_VERSION } from '../../apps/api/src/services/extraction/prompt.js';
import { referenceDateFor } from '../../apps/api/src/services/extraction/extraction-service.js';
import { renderThread } from '../../apps/api/src/services/import/dedup.js';
import { extractJsonObject } from '../../apps/api/src/services/extraction/parse.js';
import { ModelBudget, USD_TO_AED } from '../../apps/api/src/services/metrics/model-budget.js';
import type { ModelClient } from '../../apps/api/src/ports/model.js';
import type { ImportedMessage } from '../../apps/api/src/ports/note-repository.js';

const RUNS = 20;
const AED_CEILING = 60;
const aed = (usd: number) => usd * USD_TO_AED;

type Bucket = 'meeting' | 'key_date' | 'promise';
interface Msg { sentAt: string; sender: string; body: string }
interface Probe {
  id: string; cls: string; client: string; messages: Msg[]; phrase: string;
  /** expected resolution — mechanically checked. date=YYYY-MM-DD; time=HH:MM or null (date-only). */
  expDate: string; expTime: string | null; expBuckets: Bucket[];
  /** for relative inputs: the wrong date you'd get anchoring to the decoy (earlier) message. */
  altAnchorWrongDate?: string;
}

// today (reference) is computed per input = referenceDateFor(messages) = latest message date.
const PROBES: Probe[] = [
  // ── A. Explicit weekday + time (ref = latest msg date; next occurrence of the weekday) ──
  { id: 'A1', cls: 'A · weekday+time', client: 'Rashid Al Falasi', phrase: 'Thursday 3pm', expDate: '2026-09-17', expTime: '15:00', expBuckets: ['meeting'],
    messages: [{ sentAt: '2026-09-14T10:00:00', sender: 'Me', body: 'confirming the villa viewing' }, { sentAt: '2026-09-14T10:02:00', sender: 'Rashid', body: 'yes, Thursday 3pm at the villa' }] },
  { id: 'A2', cls: 'A · weekday+time', client: 'Fatima Noor', phrase: 'Sunday 10am', expDate: '2026-09-20', expTime: '10:00', expBuckets: ['meeting'],
    messages: [{ sentAt: '2026-09-15T09:00:00', sender: 'Me', body: 'when for the Marina handover?' }, { sentAt: '2026-09-15T09:05:00', sender: 'Fatima', body: 'Sunday 10am works' }] },
  { id: 'A3', cls: 'A · weekday+time', client: 'Khalid Rahman', phrase: 'Monday 9am', expDate: '2026-09-21', expTime: '09:00', expBuckets: ['meeting'],
    messages: [{ sentAt: '2026-09-16T11:00:00', sender: 'Me', body: 'site tour at Dubai Hills?' }, { sentAt: '2026-09-16T11:10:00', sender: 'Khalid', body: "let's do Monday 9am" }] },
  { id: 'A4', cls: 'A · weekday+time', client: 'Sara Ibrahim', phrase: 'Friday 5pm', expDate: '2026-09-18', expTime: '17:00', expBuckets: ['meeting'],
    messages: [{ sentAt: '2026-09-14T14:00:00', sender: 'Me', body: 'contract signing time?' }, { sentAt: '2026-09-14T14:03:00', sender: 'Sara', body: 'Friday 5pm at your office' }] },

  // ── B. Explicit date + time (with year → fully resolvable) ──
  { id: 'B1', cls: 'B · date+time', client: 'Omar Siddiqui', phrase: '22 January 2027 at 11am', expDate: '2027-01-22', expTime: '11:00', expBuckets: ['meeting'],
    messages: [{ sentAt: '2026-09-14T12:00:00', sender: 'Omar', body: "let's do 22 January 2027 at 11am for the handover" }, { sentAt: '2026-09-14T12:01:00', sender: 'Me', body: 'noted' }] },
  { id: 'B2', cls: 'B · date+time', client: 'Layla Hassan', phrase: '3 December 2026 at 2:30pm', expDate: '2026-12-03', expTime: '14:30', expBuckets: ['meeting'],
    messages: [{ sentAt: '2026-09-15T15:00:00', sender: 'Me', body: 'when for the final walkthrough?' }, { sentAt: '2026-09-15T15:04:00', sender: 'Layla', body: '3 December 2026 at 2:30pm' }] },
  { id: 'B3', cls: 'B · date+time', client: 'Bilal Ahmed', phrase: '18 August 2027, 9am', expDate: '2027-08-18', expTime: '09:00', expBuckets: ['meeting'],
    messages: [{ sentAt: '2026-09-16T08:00:00', sender: 'Bilal', body: 'mortgage review 18 August 2027, 9am please' }, { sentAt: '2026-09-16T08:02:00', sender: 'Me', body: 'booked' }] },
  { id: 'B4', cls: 'B · date+time', client: 'Hind Al Marri', phrase: '7 April 2027 at 4pm', expDate: '2027-04-07', expTime: '16:00', expBuckets: ['meeting'],
    messages: [{ sentAt: '2026-09-14T17:00:00', sender: 'Me', body: 'townhouse viewing date?' }, { sentAt: '2026-09-14T17:06:00', sender: 'Hind', body: '7 April 2027 at 4pm' }] },

  // ── C. Explicit date, NO time (with year → resolvable date; a fabricated time is a failure) ──
  { id: 'C1', cls: 'C · date, no time', client: 'Yusuf Ibrahim', phrase: 'handover on 3 March 2027', expDate: '2027-03-03', expTime: null, expBuckets: ['key_date'],
    messages: [{ sentAt: '2026-09-14T13:00:00', sender: 'Yusuf', body: 'the handover is on 3 March 2027' }, { sentAt: '2026-09-14T13:01:00', sender: 'Me', body: 'great, thanks' }] },
  { id: 'C2', cls: 'C · date, no time', client: 'Mariam Saleh', phrase: 'possession 30 November 2026', expDate: '2026-11-30', expTime: null, expBuckets: ['key_date'],
    messages: [{ sentAt: '2026-09-15T16:00:00', sender: 'Me', body: 'when is possession?' }, { sentAt: '2026-09-15T16:03:00', sender: 'Mariam', body: 'possession date is 30 November 2026' }] },
  { id: 'C3', cls: 'C · date, no time', client: 'Tariq Aziz', phrase: 'policy renews 1 July 2027', expDate: '2027-07-01', expTime: null, expBuckets: ['key_date'],
    messages: [{ sentAt: '2026-09-16T10:00:00', sender: 'Tariq', body: 'my policy renews 1 July 2027' }, { sentAt: '2026-09-16T10:02:00', sender: 'Me', body: "I'll flag it" }] },

  // ── D. Relative, unambiguous (decoy earlier message on a different date for anchor detection) ──
  { id: 'D1', cls: 'D · relative', client: 'Nadia Fares', phrase: 'tomorrow at 4', expDate: '2026-09-15', expTime: '16:00', expBuckets: ['meeting'], altAnchorWrongDate: '2026-09-13',
    messages: [{ sentAt: '2026-09-12T10:00:00', sender: 'Me', body: 'shall we schedule the viewing?' }, { sentAt: '2026-09-14T18:00:00', sender: 'Nadia', body: 'yes, tomorrow at 4 for the viewing' }] },
  { id: 'D2', cls: 'D · relative', client: 'Ravi Kumar', phrase: 'day after tomorrow at 10am', expDate: '2026-09-17', expTime: '10:00', expBuckets: ['meeting'], altAnchorWrongDate: '2026-09-15',
    messages: [{ sentAt: '2026-09-13T09:00:00', sender: 'Me', body: 'need a time for the deposit paperwork' }, { sentAt: '2026-09-15T11:00:00', sender: 'Ravi', body: 'day after tomorrow at 10am' }] },
  { id: 'D3', cls: 'D · relative', client: 'Zoya Iqbal', phrase: 'tomorrow at 9am', expDate: '2026-09-17', expTime: '09:00', expBuckets: ['meeting'], altAnchorWrongDate: '2026-09-15',
    messages: [{ sentAt: '2026-09-14T20:00:00', sender: 'Me', body: 'insurance signing?' }, { sentAt: '2026-09-16T08:30:00', sender: 'Zoya', body: 'tomorrow at 9am is fine' }] },
  { id: 'D4', cls: 'D · relative', client: 'Ahmed Al Nuaimi', phrase: 'in two days at noon', expDate: '2026-09-20', expTime: '12:00', expBuckets: ['meeting'], altAnchorWrongDate: '2026-09-17',
    messages: [{ sentAt: '2026-09-15T10:00:00', sender: 'Me', body: 'when can we meet on the JVC deal?' }, { sentAt: '2026-09-18T14:00:00', sender: 'Ahmed', body: 'in two days at noon' }] },

  // ── E. Explicit with year (closing/sign/payment) ──
  { id: 'E1', cls: 'E · explicit+year', client: 'Priya Menon', phrase: 'closing 15 June 2027', expDate: '2027-06-15', expTime: null, expBuckets: ['key_date'],
    messages: [{ sentAt: '2026-09-14T11:00:00', sender: 'Priya', body: 'closing is 15 June 2027' }, { sentAt: '2026-09-14T11:01:00', sender: 'Me', body: 'understood' }] },
  { id: 'E2', cls: 'E · explicit+year', client: 'Saeed Al Blooshi', phrase: '12 October 2026 at 1pm', expDate: '2026-10-12', expTime: '13:00', expBuckets: ['meeting'],
    messages: [{ sentAt: '2026-09-15T13:00:00', sender: 'Me', body: 'signing appointment?' }, { sentAt: '2026-09-15T13:05:00', sender: 'Saeed', body: 'we sign on 12 October 2026 at 1pm' }] },
  { id: 'E3', cls: 'E · explicit+year', client: 'Aisha Khan', phrase: 'final payment due 28 February 2027', expDate: '2027-02-28', expTime: null, expBuckets: ['key_date'],
    messages: [{ sentAt: '2026-09-16T09:00:00', sender: 'Aisha', body: 'final payment due 28 February 2027' }, { sentAt: '2026-09-16T09:02:00', sender: 'Me', body: 'noted, thank you' }] },

  // ── F. Time-only, same-day context ("this evening/afternoon/tonight" fixes day = ref date) ──
  { id: 'F1', cls: 'F · time-only same-day', client: 'Dina Farouk', phrase: 'call at 6 this evening', expDate: '2026-09-14', expTime: '18:00', expBuckets: ['meeting'], altAnchorWrongDate: '2026-09-12',
    messages: [{ sentAt: '2026-09-12T10:00:00', sender: 'Me', body: 'best way to reach you today?' }, { sentAt: '2026-09-14T15:00:00', sender: 'Dina', body: "let's do a call at 6 this evening" }] },
  { id: 'F2', cls: 'F · time-only same-day', client: 'Vikram Singh', phrase: 'at 3 this afternoon', expDate: '2026-09-15', expTime: '15:00', expBuckets: ['meeting'], altAnchorWrongDate: '2026-09-13',
    messages: [{ sentAt: '2026-09-13T09:00:00', sender: 'Me', body: 'can you drop by the office?' }, { sentAt: '2026-09-15T11:00:00', sender: 'Vikram', body: 'come by at 3 this afternoon' }] },
  { id: 'F3', cls: 'F · time-only same-day', client: 'Huda Al Ali', phrase: 'call at 8 tonight', expDate: '2026-09-16', expTime: '20:00', expBuckets: ['meeting'], altAnchorWrongDate: '2026-09-14',
    messages: [{ sentAt: '2026-09-14T18:00:00', sender: 'Me', body: 'when suits for the renewal call?' }, { sentAt: '2026-09-16T17:00:00', sender: 'Huda', body: "let's do a call at 8 tonight" }] },

  // ── G. Code-switched but the date/time itself is stated plainly ──
  { id: 'G1', cls: 'G · code-switched (AR-EN)', client: 'Mohammed Al Fahim', phrase: '20 October 2027 الساعة 11', expDate: '2027-10-20', expTime: '11:00', expBuckets: ['meeting'],
    messages: [{ sentAt: '2026-09-14T12:00:00', sender: 'Mohammed', body: 'نراجع العقد 20 October 2027 الساعة 11 صباحاً' }, { sentAt: '2026-09-14T12:02:00', sender: 'Me', body: 'تمام' }] },
  { id: 'G2', cls: 'G · code-switched (HI-EN)', client: 'Rohit Sharma', phrase: '5 May 2027 ko 4pm', expDate: '2027-05-05', expTime: '16:00', expBuckets: ['meeting'],
    messages: [{ sentAt: '2026-09-15T10:00:00', sender: 'Rohit', body: 'documents 5 May 2027 ko 4 baje (4pm) sign karenge' }, { sentAt: '2026-09-15T10:03:00', sender: 'Me', body: 'theek hai' }] },
  { id: 'G3', cls: 'G · code-switched (AR-EN, relative)', client: 'Salma Darwish', phrase: 'bukra الساعة 2', expDate: '2026-09-16', expTime: '14:00', expBuckets: ['meeting'], altAnchorWrongDate: '2026-09-14',
    messages: [{ sentAt: '2026-09-13T11:00:00', sender: 'Me', body: 'when for the viewing?' }, { sentAt: '2026-09-15T16:00:00', sender: 'Salma', body: 'bukra الساعة 2 نلتقي' }] },
  { id: 'G4', cls: 'G · code-switched (HI-EN, weekday)', client: 'Anjali Nair', phrase: 'Wednesday ko 10 baje', expDate: '2026-09-16', expTime: '10:00', expBuckets: ['meeting'], altAnchorWrongDate: undefined,
    messages: [{ sentAt: '2026-09-12T10:00:00', sender: 'Me', body: 'site visit kab karein?' }, { sentAt: '2026-09-14T09:00:00', sender: 'Anjali', body: 'Wednesday ko 10 baje milte hain' }] },
];

interface Resolved { date: string; time: string | null; field: Bucket; type?: string }
type Verdict = 'correct' | 'correct-wrong-bucket' | 'wrong-date' | 'wrong-time' | 'fabricated-time' | 'silent-miss';
interface RunOut { verdict: Verdict; resolved: Resolved[]; wrongDate?: string; wrongTime?: string; anchorError?: boolean; confirmed?: boolean; sourceSpan?: string | null; emittedAnything: boolean; raw: unknown }

function collectResolved(o: Record<string, unknown>): Resolved[] {
  const out: Resolved[] = [];
  const m = o.meeting as { datetime?: string | null } | null | undefined;
  if (m && typeof m.datetime === 'string') out.push({ date: m.datetime.slice(0, 10), time: /T\d\d:\d\d/.test(m.datetime) ? m.datetime.slice(11, 16) : null, field: 'meeting' });
  for (const kd of (Array.isArray(o.key_dates) ? o.key_dates : []) as Array<{ date?: string | null; type?: string }>) if (typeof kd.date === 'string') out.push({ date: kd.date.slice(0, 10), time: null, field: 'key_date', type: kd.type });
  for (const p of (Array.isArray(o.promises) ? o.promises : []) as Array<{ due_date?: string | null }>) if (typeof p.due_date === 'string') out.push({ date: p.due_date.slice(0, 10), time: null, field: 'promise' });
  return out;
}

function scoreRun(parsed: unknown, p: Probe): RunOut {
  const o = (parsed ?? {}) as Record<string, unknown>;
  const meeting = o.meeting as { confirmed?: boolean; source_span?: string | null } | null | undefined;
  const resolved = collectResolved(o);
  const emittedAnything = meeting != null || (Array.isArray(o.key_dates) && o.key_dates.length > 0) || (Array.isArray(o.promises) && o.promises.length > 0);
  const base = { resolved, confirmed: meeting?.confirmed, sourceSpan: meeting?.source_span ?? null, emittedAnything, raw: parsed };
  const onExpDate = resolved.filter((r) => r.date === p.expDate);
  if (onExpDate.length === 0) {
    // No item on the expected date. Wrong date if something resolved; silent miss if nothing did.
    const wrong = resolved.find((r) => r.time !== null) ?? resolved[0];
    if (!wrong) return { verdict: 'silent-miss', ...base };
    const anchorError = p.altAnchorWrongDate !== undefined && wrong.date === p.altAnchorWrongDate;
    return { verdict: 'wrong-date', wrongDate: wrong.date, wrongTime: wrong.time ?? undefined, anchorError, ...base };
  }
  // Something landed on the right date. Check the time contract.
  const item = onExpDate.find((r) => r.field === (p.expBuckets[0])) ?? onExpDate[0]!;
  if (p.expTime === null) {
    if (item.time !== null && item.field === 'meeting') return { verdict: 'fabricated-time', wrongTime: item.time, ...base };
  } else if (item.time !== p.expTime) {
    // right date, wrong (or missing) time
    return { verdict: 'wrong-time', wrongTime: item.time ?? '(none)', ...base };
  }
  const bucketOk = onExpDate.some((r) => p.expBuckets.includes(r.field));
  return { verdict: bucketOk ? 'correct' : 'correct-wrong-bucket', ...base };
}

function wilson(k: number, n: number): [number, number] {
  if (n === 0) return [0, 0];
  const z = 1.96, phat = k / n, d = 1 + z * z / n;
  const c = phat + z * z / (2 * n), m = z * Math.sqrt(phat * (1 - phat) / n + z * z / (4 * n * n));
  return [Math.max(0, (c - m) / d), Math.min(1, (c + m) / d)];
}

async function main(): Promise<void> {
  const config = loadConfig();
  if (config.modelProvider !== 'anthropic') { console.error('need MODEL_PROVIDER=anthropic + a real key in .env'); process.exit(1); }
  const model: ModelClient = createModelClient(config, 'extraction');
  const total = PROBES.length * RUNS;
  // Projection from the prior probe's warm per-call cost (~$0.0234). Hard-abort before the AED ceiling.
  const projUsd = total * 0.026;
  console.log(`[CLEAN-DATE PROBE] ${PROBES.length} inputs × ${RUNS} = ${total} calls on ${PROMPT_VERSION} (${config.anthropicModel}), warm.`);
  console.log(`PROJECTED spend ~$${projUsd.toFixed(2)} (AED ${aed(projUsd).toFixed(2)}); HARD ABORT at AED ${AED_CEILING} ($${(AED_CEILING / USD_TO_AED).toFixed(2)}).`);
  const budget = new ModelBudget(AED_CEILING / USD_TO_AED, 0); // throws if spend exceeds the AED ceiling

  for (let i = 0; i < 2; i++) {
    const res = await model.complete({ system: EXTRACTION_SYSTEM_PROMPT, cacheSystemPrompt: true, cacheTtl: '1h', maxTokens: 512, messages: [{ role: 'user', content: buildUserMessage({ today: '2026-09-15', clientName: 'WarmCo', source: 'paste', text: `warm ${i}` }) }] });
    budget.record('extraction', config.anthropicModel, res.usage ?? { inputTokens: 0, outputTokens: 0 });
  }
  console.log(`warm-up done ($${budget.totalUsd().toFixed(4)}). First real call is the credit liveness test (fails fast if depleted).`);

  const records: Array<{ p: Probe; today: string; runs: RunOut[] }> = [];
  let done = 0;
  for (const p of PROBES) {
    const today = referenceDateFor({ messages: p.messages as unknown as ImportedMessage[] }, '2026-09-19');
    const text = renderThread(p.messages as unknown as ImportedMessage[]);
    const runs: RunOut[] = [];
    for (let i = 0; i < RUNS; i++) {
      const res = await model.complete({ system: EXTRACTION_SYSTEM_PROMPT, cacheSystemPrompt: true, cacheTtl: '1h', maxTokens: EXTRACTION_MAX_TOKENS, messages: [{ role: 'user', content: buildUserMessage({ today, clientName: p.client, source: 'whatsapp_export', text }) }] });
      budget.record('extraction', config.anthropicModel, res.usage ?? { inputTokens: 0, outputTokens: 0 });
      budget.check();
      runs.push(scoreRun(extractJsonObject(res.text), p));
      done++;
      process.stdout.write(`\r  ${p.id}: ${i + 1}/${RUNS} · ${done}/${total} · $${budget.totalUsd().toFixed(2)}   `);
    }
    const correct = runs.filter((r) => r.verdict === 'correct').length;
    console.log(`\r  ${p.id} (${p.cls}) — ${correct}/${RUNS} correct · today(ref)=${today} · exp ${p.expDate}${p.expTime ? 'T' + p.expTime : ''}          `);
    records.push({ p, today, runs });
  }

  const rep = budget.report();
  const out: string[] = [];
  out.push(`# Clean-input date/time accuracy — DATA (machine record)\n`);
  out.push(`Run ${new Date().toISOString()} · prompt \`${PROMPT_VERSION}\` UNCHANGED · model \`${config.anthropicModel}\` · ${RUNS} runs/input · N=${total}.`);
  out.push(`Anchor = referenceDateFor (latest message date), exactly as production. Nothing changed.\n`);
  out.push(`**Total spend: $${rep.totalUsd.toFixed(4)} (AED ${rep.totalAed.toFixed(2)})** across ${total} calls + 2 warm-up.\n`);

  // Aggregate
  const allRuns = records.flatMap((r) => r.runs);
  const nCorrect = allRuns.filter((r) => r.verdict === 'correct').length;
  const [lo, hi] = wilson(nCorrect, total);
  const errN = total - nCorrect;
  out.push(`## Overall\n`);
  out.push(`- **Correct (right date, right time, right bucket): ${nCorrect}/${total} = ${(100 * nCorrect / total).toFixed(1)}%**`);
  out.push(`- **Error rate: ${errN}/${total} = ${(100 * errN / total).toFixed(1)}%** · 95% Wilson CI on accuracy [${(100 * lo).toFixed(1)}%, ${(100 * hi).toFixed(1)}%]`);
  const byVerdict: Record<string, number> = {};
  for (const r of allRuns) byVerdict[r.verdict] = (byVerdict[r.verdict] ?? 0) + 1;
  out.push(`- **By verdict:** ${Object.entries(byVerdict).map(([k, v]) => `${k}=${v}`).join(' · ')}`);
  const anchorErrs = allRuns.filter((r) => r.anchorError).length;
  const wrongDateNonAnchor = allRuns.filter((r) => r.verdict === 'wrong-date' && !r.anchorError).length;
  out.push(`- **Anchor errors: ${anchorErrs}** (resolved to the decoy message's date) · **resolution/other wrong-date: ${wrongDateNonAnchor}**`);
  out.push(`- **Silent misses: ${byVerdict['silent-miss'] ?? 0}** · **misclassification (right date, wrong bucket): ${byVerdict['correct-wrong-bucket'] ?? 0}** · **fabricated time on date-only: ${byVerdict['fabricated-time'] ?? 0}**`);

  // Per class
  out.push(`\n## By class\n`);
  out.push(`| Class | correct/N | error% |`);
  out.push(`|---|---|---|`);
  const classes = [...new Set(PROBES.map((p) => p.cls[0]))];
  for (const c of classes) {
    const rs = records.filter((r) => r.p.cls[0] === c).flatMap((r) => r.runs);
    const ok = rs.filter((r) => r.verdict === 'correct').length;
    out.push(`| ${c} | ${ok}/${rs.length} | ${(100 * (rs.length - ok) / rs.length).toFixed(1)}% |`);
  }

  // Per input
  out.push(`\n## By input (correct/20 and every distinct wrong answer with frequency)\n`);
  for (const { p, today, runs } of records) {
    const ok = runs.filter((r) => r.verdict === 'correct').length;
    const wrongs: Record<string, number> = {};
    for (const r of runs) if (r.verdict !== 'correct') {
      const key = r.verdict === 'wrong-date' ? `wrong-date ${r.wrongDate}${r.wrongTime ? 'T' + r.wrongTime : ''}${r.anchorError ? ' [ANCHOR]' : ''}`
        : r.verdict === 'wrong-time' ? `wrong-time ${r.wrongTime}`
        : r.verdict === 'fabricated-time' ? `fabricated-time ${r.wrongTime}`
        : r.verdict;
      wrongs[key] = (wrongs[key] ?? 0) + 1;
    }
    const confSet = [...new Set(runs.map((r) => String(r.confirmed)))].join('/');
    out.push(`\n**${p.id}** (${p.cls}) — exp \`${p.expDate}${p.expTime ? 'T' + p.expTime : ' (date only)'}\` in ${p.expBuckets.join('|')} · ref(today)=${today} · **${ok}/${RUNS} correct**`);
    out.push(`- phrase: \`${p.phrase}\` · confirmed values seen: ${confSet}`);
    out.push(`- wrong answers: ${Object.keys(wrongs).length ? Object.entries(wrongs).map(([k, v]) => `${k} ×${v}`).join(' · ') : '(none)'}`);
  }

  writeFileSync('CLEAN-DATE-ACCURACY-DATA.md', out.join('\n') + '\n');
  writeFileSync('CLEAN-DATE-ACCURACY-RAW.json', JSON.stringify(records.map(({ p, today, runs }) => ({ id: p.id, cls: p.cls, today, expDate: p.expDate, expTime: p.expTime, runs: runs.map((r) => ({ verdict: r.verdict, resolved: r.resolved, confirmed: r.confirmed, sourceSpan: r.sourceSpan, raw: r.raw })) })), null, 2) + '\n');
  console.log(`\nwrote CLEAN-DATE-ACCURACY-DATA.md + CLEAN-DATE-ACCURACY-RAW.json · total $${rep.totalUsd.toFixed(4)} (AED ${rep.totalAed.toFixed(2)}) · overall ${nCorrect}/${total} correct`);
}

main().catch((e) => { console.error('\nPROBE RUN FAILED:', e); process.exit(1); });
