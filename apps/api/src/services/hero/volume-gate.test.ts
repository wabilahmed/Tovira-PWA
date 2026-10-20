import { describe, it, expect } from 'vitest';
import { evaluateGate } from './volume-gate.js';

const config = { minClients: 5, minNotes: 20 };

describe('[P4b-4] volume gate', () => {
  it('is locked below the threshold, with concrete unlock criteria', () => {
    const gate = evaluateGate({ clients: 2, notes: 5 }, config);
    expect(gate.unlocked).toBe(false);
    expect(gate.needed).toEqual({ clients: 3, notes: 15 });
    expect(gate.message).toMatch(/3 more clients/);
    expect(gate.message).toMatch(/15 more notes/);
  });

  it('unlocks once both thresholds are met', () => {
    expect(evaluateGate({ clients: 5, notes: 20 }, config).unlocked).toBe(true);
    expect(evaluateGate({ clients: 9, notes: 40 }, config).unlocked).toBe(true);
  });

  it('needs both dimensions — clients alone is not enough', () => {
    expect(evaluateGate({ clients: 10, notes: 3 }, config).unlocked).toBe(false);
  });
});

/** [P34-6] The Today screen quotes the REAL gate in its copy — so the gate state carries the thresholds. */
describe('[P34-6] the gate reports its thresholds', () => {
  it('thresholds come from the config, locked or unlocked', () => {
    expect(evaluateGate({ clients: 2, notes: 5 }, { minClients: 7, minNotes: 33 }).thresholds).toEqual({ clients: 7, notes: 33 });
    expect(evaluateGate({ clients: 9, notes: 40 }, { minClients: 5, minNotes: 20 }).thresholds).toEqual({ clients: 5, notes: 20 });
  });
});
