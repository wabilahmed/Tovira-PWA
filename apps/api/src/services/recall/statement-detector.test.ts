import { describe, it, expect } from 'vitest';
import { ModelStatementDetector } from './statement-detector.js';
import type { ModelClient } from '../../ports/model.js';

const model = (text: string): ModelClient => ({ complete: async () => ({ text }) });
const clients = ['Sarah', 'Ahmed'];

describe('[ASK-CAPTURE] statement detection is conservative — questions never become facts', () => {
  it('flags a clear factual statement about a named client, keeping the verbatim text', async () => {
    const d = new ModelStatementDetector(model('{"isStatement":true,"clientRef":"Sarah"}'));
    const r = await d.detect('actually Sarah moved to Meridian Capital', clients);
    expect(r.isStatement).toBe(true);
    expect(r.clientRef).toBe('Sarah');
    expect(r.text).toBe('actually Sarah moved to Meridian Capital'); // verbatim, never a paraphrase
  });

  it('does NOT flag a question, even one shaped like it mentions a fact', async () => {
    const d = new ModelStatementDetector(model('{"isStatement":false,"clientRef":null}'));
    const r = await d.detect('did Ahmed say he wanted a 2-bed?', clients);
    expect(r.isStatement).toBe(false);
    expect(r.clientRef).toBeNull();
  });

  it('defaults to NOT-a-statement when the model output is unparseable (never flag by accident)', async () => {
    const d = new ModelStatementDetector(model('I think maybe yes?'));
    expect((await d.detect('Sarah moved', clients)).isStatement).toBe(false);
  });

  it('defaults to NOT-a-statement when the model call throws', async () => {
    const throwing: ModelClient = { complete: async () => { throw new Error('down'); } };
    const d = new ModelStatementDetector(throwing);
    expect((await d.detect('Sarah moved', clients)).isStatement).toBe(false);
  });

  it('a statement with no clearly-named client → clientRef null (caller must ask which, store nothing)', async () => {
    const d = new ModelStatementDetector(model('{"isStatement":true,"clientRef":null}'));
    const r = await d.detect('they moved offices last week', clients);
    expect(r.isStatement).toBe(true);
    expect(r.clientRef).toBeNull();
  });

  it('an empty turn is never a statement', async () => {
    const d = new ModelStatementDetector(model('{"isStatement":true,"clientRef":"Sarah"}'));
    expect((await d.detect('   ', clients)).isStatement).toBe(false);
  });
});
