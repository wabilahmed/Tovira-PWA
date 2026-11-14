import { describe, it, expect } from 'vitest';
import { ExtractionService } from '../extraction/extraction-service.js';
import { InMemoryClientRepository } from '../../adapters/clients/in-memory-client-repository.js';
import { InMemoryNoteRepository } from '../../adapters/notes/in-memory-note-repository.js';
import { InMemoryFactsRepository } from '../../adapters/facts/in-memory-facts-repository.js';
import { InMemoryExtractionLogRepository } from '../../adapters/logs/in-memory-extraction-log-repository.js';
import { InMemoryRequirementRepository } from '../../adapters/requirements/in-memory-requirement-repository.js';
import { InMemoryClientPointerRepository } from '../../adapters/import/in-memory-client-pointer-repository.js';
import { StubEmbedder } from '../../adapters/embedding/stub.js';
import { caresAbout } from '../clients/cares-about.js';
import type { ModelClient } from '../../ports/model.js';
import { RECRUITMENT_CHAT, RECRUITMENT_CLIENT, RECRUITMENT_RUNS } from '../../test-support/recruitment-card.fixture.js';

/**
 * [P69-14 · owner] Pregnancy is health data whatever category the extraction gives it, blocked at store time on
 * every capture path. The fixture is the landing Recruitment card as the real model extracted it in 5 runs: the
 * pregnancy was filed as "family" every time. Bar: "Wants hybrid" is kept 5/5, pregnancy is stored 0/5 anywhere
 * (facts, asks, dates, worries, receipt text, the requirements spine, the pointer set). The pregnancy check below is
 * a plain word list, independent of the block's own matcher.
 */
const PREGNANCY_WORDS = /pregnan|baby|expecting|maternity|paternity|fertility|ivf/i;

function models(...responses: string[]): ModelClient {
  let i = 0;
  return { complete: async () => ({ text: responses[Math.min(i++, responses.length - 1)]! }) };
}

async function storeRun(extraction: object, pointerJson = JSON.stringify({ pointers: [] })) {
  const clients = new InMemoryClientRepository();
  const notes = new InMemoryNoteRepository();
  const requirements = new InMemoryRequirementRepository();
  const pointers = new InMemoryClientPointerRepository();
  const client = await clients.create('u', RECRUITMENT_CLIENT);
  const note = await notes.create('u', { clientId: client.id, source: 'paste', rawText: RECRUITMENT_CHAT, audioKey: null, status: 'pending_extraction' });
  const svc = new ExtractionService(
    models(JSON.stringify(extraction), pointerJson), clients, notes, new InMemoryFactsRepository(), new StubEmbedder(8), new InMemoryExtractionLogRepository(), 'stub',
    undefined, undefined, undefined, undefined, undefined, undefined, requirements, undefined, undefined, undefined, undefined, undefined, undefined, pointers,
  );
  await svc.extractNote('u', note.id, '2026-11-12');
  const stored = (await notes.findByIdForUser('u', note.id))!;
  const reqs = await requirements.listByClient('u', client.id);
  const set = await pointers.getForClient('u', client.id);
  const cares = caresAbout({ clientName: RECRUITMENT_CLIENT, notes: [stored], requirements: reqs, nowMs: Date.parse('2026-11-12') });
  return { stored, reqs, set, cares };
}

/** Every stored field the block covers: facts, asks, dates, worries, people, and every receipt quote. */
function storedText(ex: Record<string, unknown>): string[] {
  const out: string[] = [];
  const pick = (arr: unknown, keys: string[]) => { for (const x of Array.isArray(arr) ? arr : []) for (const k of keys) { const v = (x as Record<string, unknown>)[k]; if (typeof v === 'string') out.push(v); } };
  pick(ex.personal_facts, ['subject', 'fact', 'source_span']);
  pick(ex.key_dates, ['description', 'date_raw', 'source_span']);
  pick(ex.requirements, ['text', 'requirement_raw']);
  pick(ex.people, ['name', 'role', 'source_span']);
  pick(ex.promises, ['source_span']);
  for (const c of Array.isArray(ex.concerns) ? ex.concerns : []) if (typeof c === 'string') out.push(c);
  return out;
}

describe('[P69-14] pregnancy is blocked at store time — the Recruitment card fixture', () => {
  it('hybrid is kept 5/5 and pregnancy is stored 0/5 anywhere', async () => {
    let hybrid = 0;
    let pregnancy = 0;
    for (const run of RECRUITMENT_RUNS) {
      const { stored, reqs, cares } = await storeRun(run);
      const text = [...storedText(stored.extracted as Record<string, unknown>), ...reqs.flatMap((r) => [r.text, r.requirementRaw])];
      if (text.some((t) => PREGNANCY_WORDS.test(t))) pregnancy += 1;
      if (cares.some((c) => /hybrid/i.test(c.text))) hybrid += 1;
    }
    expect({ hybrid, pregnancy }).toEqual({ hybrid: 5, pregnancy: 0 });
  });

  it('the hybrid item keeps its receipt, with the pregnancy clause blanked by the marker', async () => {
    for (const run of RECRUITMENT_RUNS) {
      const { cares } = await storeRun(run);
      const item = cares.find((c) => /hybrid/i.test(c.text))!;
      expect(item.quote).toBe("[health detail redacted] I'd want hybrid");
    }
  });

  it('run 1: "Expecting a baby" is dropped whole, the ask becomes "Hybrid work arrangement", the worry is untouched', async () => {
    const { stored, reqs } = await storeRun(RECRUITMENT_RUNS[0]!);
    const ex = stored.extracted as { personal_facts: unknown[]; concerns: string[] };
    expect(ex.personal_facts).toEqual([]);
    expect(reqs.map((r) => r.text)).toEqual(['Hybrid work arrangement']);
    expect(ex.concerns).toEqual(['Not looking to move right now']);
  });

  it('run 5: the mixed fact keeps only its non-sensitive clause', async () => {
    const { stored } = await storeRun(RECRUITMENT_RUNS[4]!);
    const ex = stored.extracted as { personal_facts: Array<{ fact: string; source_span: string }> };
    expect(ex.personal_facts.map((f) => f.fact)).toEqual(['will want hybrid option afterward']);
  });

  it('the pointer set is cut the same way: text cut, receipt blanked, an all-pregnancy pointer dropped', async () => {
    const r = { source_span: "after the baby I'd want hybrid", source_message_at: null };
    const { set } = await storeRun(RECRUITMENT_RUNS[0]!, JSON.stringify({ pointers: [
      { section: 'close', text: 'Offer a hybrid role after the baby', receipts: [r] },
      { section: 'relationship', text: 'Expecting a baby', receipts: [r] },
    ] }));
    expect(set!.pointers.map((p) => p.text)).toEqual(['Offer a hybrid role']);
    expect(set!.pointers[0]!.receipts[0]!.source_span).toBe("[health detail redacted] I'd want hybrid");
  });
});
