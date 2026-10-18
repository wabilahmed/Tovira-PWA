import { describe, it, expect } from 'vitest';
import { EVAL_NOTES } from './eval-set.js';
import { IMPORT_FIXTURES } from './import-fixtures.js';
import { parseWhatsAppExport } from '../services/import/whatsapp.js';
import { planWindows } from '../services/extraction/windowed.js';
import { loadConfig } from '../config.js';

/**
 * [P23-B5] No regression from EXTRACT_WINDOWED on the certified eval: windowing only engages for an
 * imported chat OVER the threshold, and every certified case is at or below it — so with the switch on,
 * their requests and output are byte-identical to switch-off (windowed-extraction.test.ts proves the
 * not-windowed path is byte-identical). The only cases above N are the two CERT-ONLY import fixtures,
 * which must still pass their invariant contract when windowed (run via long-chats/run.ts).
 */
const cfg = loadConfig({ DATABASE_URL: 'x', EXTRACT_WINDOWED: '1' }).windowing;
const count = (t: string) => { const p = parseWhatsAppExport(t); return p.ok ? p.messages.length : 0; };

describe('[P23-B5] windowing never engages on the certified eval', () => {
  it('every certified eval note is at or below N (non-chat notes are never windowed)', () => {
    for (const n of EVAL_NOTES) {
      if (n.source !== 'whatsapp_export') continue;
      expect(planWindows(count(n.note), cfg), n.id).toBeNull();
    }
  });
  it('the CI import fixture is at or below N; the only cases above N are the two cert-only fixtures', () => {
    const above = IMPORT_FIXTURES.filter((f) => planWindows(count(f.transcript), cfg) !== null);
    expect(above.map((f) => [f.id, f.tier])).toEqual([['import-medium-farah', 'cert-only'], ['import-hard-imtinan', 'cert-only']]);
    for (const f of IMPORT_FIXTURES.filter((x) => x.tier === 'ci-subset')) expect(planWindows(count(f.transcript), cfg), f.id).toBeNull();
  });
});
