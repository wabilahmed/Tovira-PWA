/**
 * [TIME-AMBIGUITY-PROBE] Exploratory, REPORT-ONLY probe of how the certified production
 * extractor (tovira-extract-v0.9.5, unchanged) handles time expressions that have no single
 * correct answer: explicit ranges, self-corrections, religious/cultural relative times, vague
 * approximations, and code-switched (Arabic/Hindi/Urdu-English) inputs.
 *
 * This is a PROBE, not a fix. It changes NOTHING — not the prompt, schema, gate, or any fixture.
 * It makes real extraction calls (spends credits). Each input runs a FIXED 5 times; we report ALL
 * outcomes including run-to-run disagreement. Variance IS the finding — we never re-roll.
 *
 * We call the EXACT production path the extraction service uses on a chat/paste note:
 *   EXTRACTION_SYSTEM_PROMPT (cached prefix, byte-identical) + buildUserMessage({today, client, source, text})
 *   on the real 'extraction' model client, parsed with the production extractJsonObject.
 * Chat inputs are rendered exactly as production renders an imported thread: "[<ISO sentAt>] sender: body".
 *
 *   bash -c 'set -a; source ./.env; set +a; : "${DATABASE_URL:=postgres://x:x@localhost:5432/x}"; \
 *     export DATABASE_URL; npx tsx tests/staging/time-ambiguity-probe.ts'
 */
import { writeFileSync } from 'node:fs';
import { loadConfig } from '../../apps/api/src/config.js';
import { createModelClient } from '../../apps/api/src/container.js';
import {
  EXTRACTION_SYSTEM_PROMPT,
  EXTRACTION_MAX_TOKENS,
  buildUserMessage,
  PROMPT_VERSION,
  type ExtractionPromptInput,
} from '../../apps/api/src/services/extraction/prompt.js';
import { extractJsonObject } from '../../apps/api/src/services/extraction/parse.js';
import { ModelBudget, USD_TO_AED } from '../../apps/api/src/services/metrics/model-budget.js';
import type { ModelClient } from '../../apps/api/src/ports/model.js';

const TODAY = '2026-09-15'; // Tuesday — fixed so relative resolution ("tomorrow", "Thursday") is deterministic across the run.
const RUNS = 5;
const aed = (usd: number) => usd * USD_TO_AED;

type Src = ExtractionPromptInput['source'];
interface Probe {
  id: string;
  cls: string;
  source: Src;
  client: string;
  text: string;
  note: string; // the ambiguous expression under test
}

// Each input embeds the ambiguous phrase in a short, realistic UAE real-estate/insurance exchange,
// rendered as production renders an imported chat: "[<ISO sentAt>] sender: body".
const PROBES: Probe[] = [
  // A. Explicit ranges
  { id: 'A1', cls: 'A · explicit range', source: 'whatsapp_export', client: 'Rashid Al Falasi', note: 'between 1-4pm',
    text: `[2026-09-14T18:03:00] Rashid: salaam, can we do the villa viewing tomorrow?\n[2026-09-14T18:05:00] Me: sure, what time works for you?\n[2026-09-14T18:06:00] Rashid: let's meet somewhere between 1-4pm` },
  { id: 'A2', cls: 'A · explicit range', source: 'whatsapp_export', client: 'Fatima Noor', note: '10 to 12 tomorrow',
    text: `[2026-09-14T09:15:00] Me: when are you free for the Marina apartment handover?\n[2026-09-14T09:20:00] Fatima: I'm free 10 to 12 tomorrow` },
  { id: 'A3', cls: 'A · explicit range', source: 'whatsapp_export', client: 'Khalid Rahman', note: 'between Thursday and Saturday',
    text: `[2026-09-13T11:00:00] Me: when can we schedule the Dubai Hills site tour?\n[2026-09-13T11:12:00] Khalid: anytime between Thursday and Saturday works for me` },

  // B. Self-correction / stutter
  { id: 'B1', cls: 'B · self-correction', source: 'whatsapp_export', client: 'Bilal Ahmed', note: 'at 2 2:30 pm',
    text: `[2026-09-14T20:01:00] Bilal: bro let's do the meeting at 2 2:30 pm tomorrow for the mortgage docs\n[2026-09-14T20:02:00] Me: got it` },
  { id: 'B2', cls: 'B · self-correction', source: 'whatsapp_export', client: 'Sana Malik', note: 'Monday — no wait, Tuesday',
    text: `[2026-09-14T14:30:00] Me: which day should I block for the contract signing?\n[2026-09-14T14:33:00] Sana: Monday — no wait, Tuesday` },
  { id: 'B3', cls: 'B · self-correction', source: 'whatsapp_export', client: 'Aisha Khan', note: 'at 5, actually make it 6',
    text: `[2026-09-14T17:45:00] Aisha: call me at 5, actually make it 6\n[2026-09-14T17:46:00] Me: noted, will call at 6` },

  // C. Relative religious / cultural time
  { id: 'C1', cls: 'C · religious/cultural', source: 'whatsapp_export', client: 'Yusuf Ibrahim', note: 'after Asr',
    text: `[2026-09-14T13:00:00] Me: when should I come by with the tenancy contract?\n[2026-09-14T13:10:00] Yusuf: after Asr` },
  { id: 'C2', cls: 'C · religious/cultural', source: 'whatsapp_export', client: 'Mariam Saleh', note: 'بعد المغرب around 8',
    text: `[2026-09-14T16:20:00] Me: what time tomorrow for the handover?\n[2026-09-14T16:25:00] Mariam: بعد المغرب around 8` },
  { id: 'C3', cls: 'C · religious/cultural', source: 'whatsapp_export', client: 'Omar Siddiqui', note: 'before Jummah on Friday',
    text: `[2026-09-11T10:00:00] Me: can we finalize the insurance renewal this week?\n[2026-09-11T10:05:00] Omar: before Jummah on Friday inshallah` },

  // D. Vague approximations
  { id: 'D1', cls: 'D · vague', source: 'whatsapp_export', client: 'Hind Al Marri', note: 'next week sometime',
    text: `[2026-09-14T12:00:00] Me: when do you want to see the JVC townhouses?\n[2026-09-14T12:15:00] Hind: next week sometime` },
  { id: 'D2', cls: 'D · vague', source: 'whatsapp_export', client: 'Ravi Kumar', note: 'end of the month',
    text: `[2026-09-14T15:00:00] Ravi: I'll transfer the booking deposit end of the month\n[2026-09-14T15:01:00] Me: perfect, thanks` },
  { id: 'D3', cls: 'D · vague', source: 'whatsapp_export', client: 'Layla Hassan', note: 'morning is better for me',
    text: `[2026-09-14T08:30:00] Me: morning or evening for the viewing?\n[2026-09-14T08:35:00] Layla: morning is better for me` },
  { id: 'D4', cls: 'D · vague', source: 'whatsapp_export', client: 'Tariq Aziz', note: 'in shaa Allah tomorrow',
    text: `[2026-09-14T19:00:00] Me: are we still on for the office viewing?\n[2026-09-14T19:10:00] Tariq: in shaa Allah tomorrow` },

  // E. Code-switched (Arabic/Hindi/Urdu-English), each carrying a time expression
  { id: 'E1', cls: 'E · code-switched', source: 'whatsapp_export', client: 'Nadia Fares', note: 'bukra بعد الظهر, maybe 3 or 4',
    text: `[2026-09-14T11:00:00] Nadia: يعني نلتقي bukra بعد الظهر, maybe 3 or 4\n[2026-09-14T11:02:00] Me: ok works for me` },
  { id: 'E2', cls: 'E · code-switched', source: 'whatsapp_export', client: 'Vikram Singh', note: 'kal shaam ko, around 7 baje',
    text: `[2026-09-14T18:30:00] Vikram: bhai kal shaam ko milte hain, around 7 baje\n[2026-09-14T18:31:00] Me: theek hai` },
  { id: 'E3', cls: 'E · code-switched', source: 'whatsapp_export', client: 'Zoya Iqbal', note: 'kal ya parso, subah ke waqt',
    text: `[2026-09-14T21:00:00] Me: when can you come sign the insurance papers?\n[2026-09-14T21:05:00] Zoya: kal ya parso, subah ke waqt theek rahega` },

  // F. Controls
  { id: 'F1', cls: 'F · control (unambiguous)', source: 'whatsapp_export', client: 'Sameer Malik', note: 'Thursday 3pm',
    text: `[2026-09-14T10:00:00] Me: confirming our meeting\n[2026-09-14T10:01:00] Sameer: yes, meeting Thursday 3pm at your office` },
  { id: 'F2', cls: 'F · control (no time)', source: 'whatsapp_export', client: 'Dina Farouk', note: 'let\'s meet (no time)',
    text: `[2026-09-14T13:00:00] Me: would love to catch up soon\n[2026-09-14T13:05:00] Dina: yes let's meet` },
];

interface RunResult {
  ok: boolean;
  meeting: { datetime: string | null; datetime_raw: string; confirmed: boolean; source_span: string | null; source_message_at: string | null } | null;
  promises: Array<{ text: string; owner: string; due_date: string | null; due_raw: string | null; confidence: string; source_span: string | null; source_message_at: string | null }>;
  key_dates: Array<{ description: string; date: string | null; date_raw: string | null; type: string; source_span: string | null; source_message_at: string | null }>;
  raw: unknown;
}

function summariseRun(parsed: unknown): RunResult {
  const o = (parsed ?? {}) as Record<string, unknown>;
  const m = o.meeting as RunResult['meeting'] | null | undefined;
  return {
    ok: parsed !== null,
    meeting: m ?? null,
    promises: Array.isArray(o.promises) ? (o.promises as RunResult['promises']) : [],
    key_dates: Array.isArray(o.key_dates) ? (o.key_dates as RunResult['key_dates']) : [],
    raw: parsed,
  };
}

/** Where did the time land, and did the model commit to a specific clock time / calendar date? */
function classify(r: RunResult): { landedIn: string[]; committedTime: boolean; committedDate: boolean } {
  const landedIn: string[] = [];
  let committedTime = false;
  let committedDate = false;
  if (r.meeting) {
    landedIn.push('meeting');
    if (r.meeting.datetime) { committedTime = /T\d\d:\d\d/.test(r.meeting.datetime); committedDate = true; }
  }
  for (const kd of r.key_dates) { landedIn.push('key_date'); if (kd.date) committedDate = true; }
  for (const p of r.promises) { landedIn.push('promise'); if (p.due_date) committedDate = true; }
  if (landedIn.length === 0) landedIn.push('none');
  return { landedIn: [...new Set(landedIn)], committedTime, committedDate };
}

async function main(): Promise<void> {
  const config = loadConfig();
  if (config.modelProvider !== 'anthropic') {
    console.error('need MODEL_PROVIDER=anthropic + a real ANTHROPIC_API_KEY in .env');
    process.exit(1);
  }
  const model: ModelClient = createModelClient(config, 'extraction');
  const budget = new ModelBudget(6.0, 0.5);
  const totalCalls = PROBES.length * RUNS;
  console.log(`[PROBE] ${PROBES.length} inputs × ${RUNS} runs = ${totalCalls} extraction calls on ${PROMPT_VERSION} (${config.anthropicModel}), warm. today=${TODAY}.`);
  console.log(`ESTIMATE ceiling $6.00 (AED ${aed(6).toFixed(2)}); aborts at +50%.`);

  // Warm the cached prefix so the probe runs WARM (matches production steady state).
  for (let i = 0; i < 2; i++) {
    const res = await model.complete({ system: EXTRACTION_SYSTEM_PROMPT, cacheSystemPrompt: true, cacheTtl: '1h', maxTokens: 512, messages: [{ role: 'user', content: buildUserMessage({ today: TODAY, clientName: 'WarmCo', source: 'paste', text: `warm ${i}` }) }] });
    budget.record('extraction', config.anthropicModel, res.usage ?? { inputTokens: 0, outputTokens: 0 });
  }
  console.log(`warm-up done ($${budget.totalUsd().toFixed(4)}).`);

  const records: Array<{ probe: Probe; runs: RunResult[]; cacheReadSeen: boolean }> = [];
  let done = 0;
  for (const probe of PROBES) {
    const runs: RunResult[] = [];
    let cacheReadSeen = false;
    for (let i = 0; i < RUNS; i++) {
      const res = await model.complete({
        system: EXTRACTION_SYSTEM_PROMPT,
        cacheSystemPrompt: true,
        cacheTtl: '1h',
        maxTokens: EXTRACTION_MAX_TOKENS,
        messages: [{ role: 'user', content: buildUserMessage({ today: TODAY, clientName: probe.client, source: probe.source, text: probe.text }) }],
      });
      const usage = res.usage ?? { inputTokens: 0, outputTokens: 0 };
      if ((usage.cacheReadInputTokens ?? 0) > 0) cacheReadSeen = true;
      budget.record('extraction', config.anthropicModel, usage);
      budget.check();
      runs.push(summariseRun(extractJsonObject(res.text)));
      done++;
      process.stdout.write(`\r  ${probe.id}: run ${i + 1}/${RUNS}  ·  ${done}/${totalCalls} calls  ·  $${budget.totalUsd().toFixed(3)}   `);
    }
    console.log(`\r  ${probe.id} (${probe.cls}) done — ${runs.map((r) => classify(r).landedIn.join('+')).join(' | ')}                    `);
    records.push({ probe, runs, cacheReadSeen });
  }

  // ---- Machine record: per-input, per-run structured dump + a consistency line. ----
  const rep = budget.report();
  const out: string[] = [];
  out.push(`# Time-ambiguity probe — DATA (machine record)\n`);
  out.push(`Run ${new Date().toISOString()} · prompt \`${PROMPT_VERSION}\` UNCHANGED · model \`${config.anthropicModel}\` · today ${TODAY} (Tuesday) · ${RUNS} runs/input.`);
  out.push(`Nothing was changed: no prompt, schema, gate, or fixture edits. Chat inputs rendered as production renders a thread ("[ISO] sender: body").`);
  out.push(`\n**Total model spend: $${rep.totalUsd.toFixed(4)} (AED ${rep.totalAed.toFixed(2)})** across ${totalCalls} probe calls + 2 warm-up. Cache read observed on every input: ${records.every((r) => r.cacheReadSeen) ? 'YES' : 'NO'}.\n`);

  for (const { probe, runs } of records) {
    out.push(`\n---\n\n## ${probe.id} — ${probe.cls}`);
    out.push(`- **client:** ${probe.client} · **source:** ${probe.source} · **ambiguous phrase:** \`${probe.note}\``);
    out.push('```\n' + probe.text + '\n```');
    // Consistency across runs.
    const landed = runs.map((r) => classify(r).landedIn.slice().sort().join('+'));
    const dts = runs.map((r) => r.meeting?.datetime ?? '·');
    const dtsRaw = runs.map((r) => r.meeting?.datetime_raw ?? '·');
    const spans = runs.map((r) => JSON.stringify(r.meeting?.source_span ?? null));
    const sma = runs.map((r) => r.meeting?.source_message_at ?? '·');
    out.push(`- **landed-in across ${RUNS} runs:** ${landed.join(' | ')}  →  ${new Set(landed).size === 1 ? 'CONSISTENT' : 'DISAGREEMENT'}`);
    out.push(`- **meeting.datetime across runs:** ${dts.join(' | ')}  →  ${new Set(dts).size === 1 ? 'consistent' : 'DISAGREEMENT'}`);
    out.push(`- **meeting.datetime_raw across runs:** ${dtsRaw.map((x) => JSON.stringify(x)).join(' | ')}`);
    out.push(`- **meeting.source_span across runs:** ${spans.join(' | ')}`);
    out.push(`- **meeting.source_message_at across runs:** ${sma.join(' | ')}`);
    out.push(`\n<details><summary>full per-run output</summary>\n`);
    runs.forEach((r, i) => {
      out.push(`\nRun ${i + 1}:`);
      out.push('```json\n' + JSON.stringify({ meeting: r.meeting, promises: r.promises, key_dates: r.key_dates }, null, 2) + '\n```');
    });
    out.push(`\n</details>`);
  }

  writeFileSync('TIME-AMBIGUITY-PROBE-DATA.md', out.join('\n') + '\n');
  // Raw JSON sidecar for full-fidelity evidence.
  writeFileSync('TIME-AMBIGUITY-PROBE-RAW.json', JSON.stringify(records.map(({ probe, runs }) => ({ id: probe.id, cls: probe.cls, client: probe.client, source: probe.source, note: probe.note, text: probe.text, runs: runs.map((r) => r.raw) })), null, 2) + '\n');
  console.log(`\nwrote TIME-AMBIGUITY-PROBE-DATA.md + TIME-AMBIGUITY-PROBE-RAW.json · total $${rep.totalUsd.toFixed(4)} (AED ${rep.totalAed.toFixed(2)})`);
}

main().catch((e) => { console.error('\nPROBE RUN FAILED:', e); process.exit(1); });
