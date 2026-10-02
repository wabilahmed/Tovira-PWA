import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

import { ExtractionService } from '../services/extraction/extraction-service.js';
import { InMemoryClientRepository } from '../adapters/clients/in-memory-client-repository.js';
import { InMemoryNoteRepository } from '../adapters/notes/in-memory-note-repository.js';
import { InMemoryFactsRepository } from '../adapters/facts/in-memory-facts-repository.js';
import { InMemoryExtractionLogRepository } from '../adapters/logs/in-memory-extraction-log-repository.js';
import { StubEmbedder } from '../adapters/embedding/stub.js';
import { ErasureService } from '../services/erasure/erasure-service.js';
import { InMemoryErasureAuditRepository } from '../adapters/erasure/in-memory-erasure-audit-repository.js';
import { InMemoryRepGlossaryRepository } from '../adapters/glossary/in-memory-rep-glossary-repository.js';
import { VERDICTS, CORRECTION_KINDS } from '../ports/correction-repository.js';

/**
 * [NO-TRAINING-RETENTION] The STANDING guards for the "stop retaining conversation content for training"
 * batch. Each one is mutation-proven (mutate the thing it protects → this file goes red): the published
 * privacy policy is only true while these hold.
 */

const here = dirname(fileURLToPath(import.meta.url));
const apiSrc = resolve(here, '..');        // apps/api/src
const apiRoot = resolve(apiSrc, '..');     // apps/api

function read(rel: string): string {
  return readFileSync(resolve(apiSrc, rel), 'utf8');
}

/** Pull the column list out of an `INSERT INTO <table> (...)` in a pg adapter's source. */
function insertColumns(src: string, table: string): string[] {
  const m = new RegExp(`INSERT INTO ${table}\\s*\\(([^)]*)\\)`, 'i').exec(src);
  if (!m) throw new Error(`no INSERT INTO ${table} found`);
  return m[1]!.split(',').map((c) => c.trim()).filter(Boolean);
}

/** Pull the SELECT column list out of a `const COLUMNS = '...'` / `const COLS = '...'` constant. */
function selectColumns(src: string, constName: string): string[] {
  const m = new RegExp(`${constName}\\s*=\\s*'([^']*)'`, 's').exec(src);
  if (!m) throw new Error(`no ${constName} column constant found`);
  return m[1]!.split(',').map((c) => c.trim()).filter(Boolean);
}

/** Every .ts file under apps/api/src (the guard excludes itself + the migrations dir, which is not here). */
function allSrcFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.ts')) out.push(p);
    }
  };
  walk(apiSrc);
  return out;
}

// ─── GUARD 1: the extraction log never carries conversation content ────────────────────────────────
describe('[GUARD 1] extraction log is metadata only — no note input, no raw model output', () => {
  // The note text is a SYNTHETIC CANARY (not real PII) so this invariant can be mutation-proven by
  // writing the canary into the log's write path without tripping the PII-handling safety classifier.
  const CANARY = 'TOVIRA-CANARY-7731';
  it('a real extraction logs a row that carries neither the note text nor a raw-output field', async () => {
    const clients = new InMemoryClientRepository();
    const notes = new InMemoryNoteRepository();
    const facts = new InMemoryFactsRepository();
    const logs = new InMemoryExtractionLogRepository();
    const model = { complete: async () => ({ text: JSON.stringify({ summary: 's', promises: [], people: [], personal_facts: [], key_dates: [], concerns: [], next_steps: [], meeting: null }), usage: { inputTokens: 0, outputTokens: 0 } }) };
    const svc = new ExtractionService(model, clients, notes, facts, new StubEmbedder(8), logs, 'stub');
    const client = await clients.create('u', 'Acme');
    const note = await notes.create('u', { clientId: client.id, source: 'paste', rawText: `Routine follow-up. ${CANARY}.`, audioKey: null, status: 'pending_extraction' });
    await svc.extractNote('u', note.id, '2026-08-01');

    const rows = await logs.listByUser('u');
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    // Structural: the forbidden content fields are not present…
    expect(row).not.toHaveProperty('input');
    expect(row).not.toHaveProperty('rawOutput');
    // …and NO field of the logged row, serialised, carries the note's content (the canary). A write-path
    // regression that put any note content into any log field would surface the canary here.
    expect(JSON.stringify(row)).not.toContain(CANARY);
    // The metadata that REPLACED content is present.
    expect(row).toHaveProperty('factsProposed');
    expect(row).toHaveProperty('rejectedByReason');
  });
});

// ─── GUARD 2: the pg adapters' columns are a content-free allow-list ────────────────────────────────
describe('[GUARD 2] extraction_logs + corrections column allow-list excludes all content columns', () => {
  const EXTRACTION_LOG_ALLOW = new Set([
    'id', 'user_id', 'note_id', 'prompt_version', 'model', 'status',
    'input_tokens', 'output_tokens', 'latency_ms', 'cache_creation_tokens', 'cache_read_tokens',
    'facts_proposed', 'facts_accepted', 'facts_rejected', 'rejected_by_reason', 'created_at',
  ]);
  const CORRECTIONS_ALLOW = new Set([
    'id', 'user_id', 'note_id', 'entity_type', 'entity_id', 'field',
    'verdict', 'correction_kind', 'date_delta_days', 'prompt_version', 'created_at',
  ]);
  const FORBIDDEN = ['input', 'raw_output', 'before_value', 'after_value'];

  it('pg-extraction-log-repository reads + writes only allow-listed columns, none of them content', () => {
    const src = read('adapters/logs/pg-extraction-log-repository.ts');
    const cols = [...insertColumns(src, 'extraction_logs'), ...selectColumns(src, 'COLUMNS')];
    for (const c of cols) {
      expect(EXTRACTION_LOG_ALLOW, `extraction_logs column "${c}" is not allow-listed`).toContain(c);
      expect(FORBIDDEN, `extraction_logs still references content column "${c}"`).not.toContain(c);
    }
  });

  it('pg-correction-repository reads + writes only allow-listed columns, none of them content', () => {
    const src = read('adapters/corrections/pg-correction-repository.ts');
    const cols = [...insertColumns(src, 'corrections'), ...selectColumns(src, 'COLS')];
    for (const c of cols) {
      expect(CORRECTIONS_ALLOW, `corrections column "${c}" is not allow-listed`).toContain(c);
      expect(FORBIDDEN, `corrections still references content column "${c}"`).not.toContain(c);
    }
  });
});

// ─── GUARD 3: the training-archive subsystem never reappears ────────────────────────────────────────
describe('[GUARD 3] the deleted training-archive subsystem stays deleted', () => {
  const DELETED_FILES = [
    'services/facts/training-archive.ts',
    'ports/archive-index-repository.ts',
    'adapters/logs/pg-archive-index-repository.ts',
    'adapters/logs/in-memory-archive-index-repository.ts',
    'services/redaction/tier2.ts', // the stored-log-input scrubber — moot with no stored input
  ];
  it('none of the deleted subsystem files exist', () => {
    for (const f of DELETED_FILES) expect(existsSync(resolve(apiSrc, f)), `${f} reappeared`).toBe(false);
  });

  it('no source re-introduces the archive service, table, job, or port', () => {
    // A JOB registration (not the tombstone comment that merely cites the retired lockKey 4711008).
    const TOKENS = ['TrainingArchiveService', 'training_archive_objects', 'ArchiveIndexRepository', "name: 'training-archive'"];
    const self = resolve(apiSrc, 'privacy/no-training-retention.guard.test.ts');
    for (const file of allSrcFiles()) {
      if (file === self) continue;
      const src = readFileSync(file, 'utf8');
      for (const tok of TOKENS) expect(src.includes(tok), `${tok} reappeared in ${file}`).toBe(false);
    }
  });

  it('config carries no training-archive keys', () => {
    expect(read('config.ts')).not.toContain('trainingArchive');
  });
});

// ─── GUARD 4: correction_kind + date_delta_days can never hold free text ────────────────────────────
describe('[GUARD 4] correction_kind is a fixed enum; date_delta_days is an integer — neither holds text', () => {
  it('the verdict + kind enums are exactly the fixed sets (no free-text escape hatch)', () => {
    expect([...VERDICTS].sort()).toEqual(['confirm', 'edit', 'reject']);
    expect([...CORRECTION_KINDS].sort()).toEqual(['date_wrong', 'missing', 'should_not_exist', 'wrong_person', 'wrong_value']);
  });

  it('migration 0077 pins the enum CHECKs, the integer type, and removes the content columns', () => {
    const mig = readFileSync(resolve(apiRoot, 'migrations/0077_corrections_verdict.sql'), 'utf8');
    // verdict + kind are constrained to the enums…
    expect(mig).toMatch(/verdict IN \('confirm', 'reject', 'edit'\)/);
    expect(mig).toMatch(/correction_kind IN \('wrong_value', 'wrong_person', 'should_not_exist', 'date_wrong', 'missing'\)/);
    // …kind is null iff confirm…
    expect(mig).toMatch(/verdict = 'confirm' AND correction_kind IS NULL/);
    // …date_delta_days is an INTEGER (cannot hold text) and only set for date corrections…
    expect(mig).toMatch(/date_delta_days integer/);
    expect(mig).toMatch(/date_delta_days IS NULL OR correction_kind = 'date_wrong'/);
    // …and the before/after content columns are removed.
    expect(mig).toMatch(/DROP COLUMN IF EXISTS before_value/);
    expect(mig).toMatch(/DROP COLUMN IF EXISTS after_value/);
  });
});

// ─── GUARD 5: single-counterparty erasure removes matching glossary terms ───────────────────────────
describe('[GUARD 5] erasure deletes rep_glossary pairs naming the erased counterparty', () => {
  it('removes a pair whose term matches the requester, keeps unrelated pairs', async () => {
    const clients = new InMemoryClientRepository();
    const notes = new InMemoryNoteRepository();
    const audit = new InMemoryErasureAuditRepository();
    const repGlossary = new InMemoryRepGlossaryRepository();
    await repGlossary.upsert('u', 'Khalld', 'Khalid', Date.now());    // names the requester (right term)
    await repGlossary.upsert('u', 'Meridiun', 'Meridian', Date.now()); // unrelated jargon

    const svc = new ErasureService({ clients, notes, audit, repGlossary });
    const result = await svc.commit('u', ['Khalid']);

    const left = await repGlossary.listByUser('u');
    expect(left.map((e) => e.rightTerm).sort()).toEqual(['Meridian']); // the Khalid pair is gone
    expect(result.categories.find((c) => c.category === 'glossary_terms')?.deleted).toBe(1);
  });
});
