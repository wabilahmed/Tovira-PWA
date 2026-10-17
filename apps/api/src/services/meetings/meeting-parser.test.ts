import { describe, it, expect, afterEach } from 'vitest';
import { MeetingParser } from './meeting-parser.js';
import { InMemoryClientRepository } from '../../adapters/clients/in-memory-client-repository.js';
import { GatedModelClient } from '../../adapters/spend/gated-ai-clients.js';
import { AiGate, setAiGate } from '../../services/spend/ai-gate.js';
import { InMemoryAiAllowanceRepository } from '../../adapters/spend/in-memory-ai-allowance-repository.js';
import type { ModelClient } from '../../ports/model.js';

function model(text: string): ModelClient {
  return { complete: async () => ({ text }) };
}
/** A model that counts calls, to prove the deterministic path makes ZERO of them. */
function spyModel(text: string): ModelClient & { calls: number } {
  const m = { calls: 0, complete: async () => { m.calls++; return { text, usage: { inputTokens: 10, outputTokens: 5 } }; } };
  return m;
}

describe('MeetingParser', () => {
  it('proposes a meeting for a single matching client and a resolvable time', async () => {
    const clients = new InMemoryClientRepository();
    const c = await clients.create('user-A', 'Meridian Corp');
    const parser = new MeetingParser(model('{"clientName":"Meridian","datetime":"2026-07-10T10:00","datetimeRaw":"Fri 10am"}'), clients);
    const r = await parser.parse('user-A', 'meeting with Meridian Fri 10am', '2026-07-09');
    expect(r.kind).toBe('proposal');
    if (r.kind === 'proposal') {
      expect(r.clientId).toBe(c.id);
      expect(r.datetime).toBe('2026-07-10T10:00');
    }
  });

  // NEGATIVE: vague time → ask for specifics, never invent a time.
  it('asks for specifics when the time is vague', async () => {
    const clients = new InMemoryClientRepository();
    await clients.create('user-A', 'Meridian Corp');
    const parser = new MeetingParser(model('{"clientName":"Meridian","datetime":null,"datetimeRaw":"sometime next week"}'), clients);
    const r = await parser.parse('user-A', 'meeting with Meridian sometime next week', '2026-07-09');
    expect(r.kind).toBe('ambiguous_time');
  });

  // NEGATIVE: two clients match → prompt which one, don't silently pick.
  it('asks which client when the name is ambiguous', async () => {
    const clients = new InMemoryClientRepository();
    await clients.create('user-A', 'Sarah Corp');
    await clients.create('user-A', 'Sarah Ltd');
    const parser = new MeetingParser(model('{"clientName":"Sarah","datetime":"2026-07-14T15:00","datetimeRaw":"next Tuesday 3pm"}'), clients);
    const r = await parser.parse('user-A', 'meeting with Sarah next Tuesday 3pm', '2026-07-09');
    expect(r.kind).toBe('ambiguous_client');
    if (r.kind === 'ambiguous_client') expect(r.candidates).toHaveLength(2);
  });

  it('reports no matching client', async () => {
    const clients = new InMemoryClientRepository();
    await clients.create('user-A', 'Meridian');
    const parser = new MeetingParser(model('{"clientName":"Ghost","datetime":"2026-07-14T15:00","datetimeRaw":"Tue 3pm"}'), clients);
    const r = await parser.parse('user-A', 'meeting with Ghost Tue 3pm', '2026-07-09');
    expect(r.kind).toBe('no_client');
  });
});

// [P16-1] The capture-friendly path for a rep who can't run AI: parse deterministically, NO model call.
describe('[P16-1] MeetingParser.parseDeterministic — no model, never blocked', () => {
  it('resolves "tomorrow 3pm" against the message date + matches the client, making ZERO model calls', async () => {
    const clients = new InMemoryClientRepository();
    const c = await clients.create('user-A', 'Sara Khan');
    const m = spyModel('UNUSED');
    const parser = new MeetingParser(m, clients);
    // "catch up with Sara ... tomorrow 3pm", message date Mon 2 Mar 2026.
    const r = await parser.parseDeterministic('user-A', 'catch up with Sara about the JVC unit tomorrow 3pm', '2026-03-02');
    expect(m.calls).toBe(0);                              // the whole point: no paid model call
    expect(r.kind).toBe('proposal');
    if (r.kind === 'proposal') {
      expect(r.clientId).toBe(c.id);                      // client matched by name token ("Sara")
      expect(r.datetime).toBe('2026-03-03T15:00');        // tomorrow + explicit 3pm
    }
  });

  it('with no resolvable time, hands back the picker (ambiguous_time) — still no model call', async () => {
    const clients = new InMemoryClientRepository();
    await clients.create('user-A', 'Sara Khan');
    const m = spyModel('UNUSED');
    const r = await new MeetingParser(m, clients).parseDeterministic('user-A', 'catch up with Sara next Thursday afternoon around four', '2026-03-02');
    expect(m.calls).toBe(0);
    // "next Thursday" + "around four" are deliberately NOT resolved (would be guesses) → picker.
    expect(r.kind).toBe('ambiguous_time');
  });
});

// [P16-1] The entitled path still runs the model, through the gate: exactly one reservation + one settle.
describe('[P16-1] MeetingParser.parse (entitled) reserves then settles exactly once', () => {
  afterEach(() => setAiGate(null)); // never leak the gate into other suites

  it('one reserve + one settle for a single model call', async () => {
    const allowance = new InMemoryAiAllowanceRepository();
    let reserves = 0, settles = 0;
    const spiedAllowance = new Proxy(allowance, {
      get(target, prop, recv) {
        if (prop === 'reserve') return async (...a: unknown[]) => { reserves++; return (target.reserve as (...x: unknown[]) => unknown)(...a); };
        if (prop === 'settle') return async (...a: unknown[]) => { settles++; return (target.settle as (...x: unknown[]) => unknown)(...a); };
        return Reflect.get(target, prop, recv);
      },
    });
    setAiGate(new AiGate({
      allowance: spiedAllowance,
      allowanceAed: 60,
      alertThresholdAed: 9999,
      billingWindowFor: async () => ({ status: 'trialing', trialEndsAt: null, renewsAt: null, periodStart: Date.parse('2026-10-01T00:00:00Z') }),
      isPaused: () => false,
      now: () => Date.parse('2026-10-10T00:00:00Z'),
    }));
    const clients = new InMemoryClientRepository();
    await clients.create('user-A', 'Meridian');
    const m = spyModel('{"clientName":"Meridian","datetime":"2026-10-12T15:00","datetimeRaw":"Mon 3pm"}');
    const parser = new MeetingParser(new GatedModelClient(m, 'claude-sonnet-5'), clients);
    const r = await parser.parse('user-A', 'meeting with Meridian Mon 3pm', '2026-10-10');
    expect(m.calls).toBe(1);
    expect(reserves).toBe(1);
    expect(settles).toBe(1);
    expect(r.kind).toBe('proposal');
  });
});
