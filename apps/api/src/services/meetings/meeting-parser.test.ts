import { describe, it, expect } from 'vitest';
import { MeetingParser } from './meeting-parser.js';
import { InMemoryClientRepository } from '../../adapters/clients/in-memory-client-repository.js';
import type { ModelClient } from '../../ports/model.js';

function model(text: string): ModelClient {
  return { complete: async () => ({ text }) };
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
