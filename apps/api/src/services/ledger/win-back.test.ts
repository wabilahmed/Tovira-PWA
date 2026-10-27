import { describe, it, expect } from 'vitest';
import { WinBackService, WIN_BACK_WINDOW_DAYS } from './win-back.js';
import { InMemoryGoingQuietAlertRepository } from '../../adapters/ledger/in-memory-going-quiet-alert-repository.js';
import { InMemoryClientRepository } from '../../adapters/clients/in-memory-client-repository.js';
import { InMemoryNoteRepository } from '../../adapters/notes/in-memory-note-repository.js';
import { restrictionForNames } from '../erasure/restriction.js';
import type { ImportedMessage } from '../../ports/note-repository.js';

/**
 * [P47-2] Owner: "Re-engaged after an alert" → "Clients Tovira helped you win back". An entry when a client sends their
 * FIRST message within 7 days after a going-quiet alert for that client REACHED the rep (a delivered push, or the Today
 * card shown; an alert only generated does not count). The message is the client's own, dated by when they sent it
 * (not when the chat was imported), and after the alert. One entry per alert.
 */
const DAY = 86_400_000;
const SHOWN = Date.parse('2026-10-01T09:00:00Z');
const wall = (ms: number) => new Date(ms).toISOString().slice(0, 16); // UTC rep: wall clock = UTC
const msg = (atMs: number, role: ImportedMessage['role'], body = 'Hi, sorry for the delay, still interested'): ImportedMessage => ({ sentAt: wall(atMs), sender: role === 'client' ? 'Sara' : 'Wabil', body, media: false, role });

async function setup(opts: { restricted?: string[] } = {}) {
  const alerts = new InMemoryGoingQuietAlertRepository();
  const clients = new InMemoryClientRepository();
  const notes = new InMemoryNoteRepository();
  const c = await clients.create('u', 'Sara Khan');
  await clients.setLastTouched('u', c.id, SHOWN - 20 * DAY); // silent 20 days when the card is shown
  const svc = new WinBackService({ alerts, clients, notes, timezoneFor: async () => 'UTC', coldThresholdDays: 14, ...(opts.restricted ? { restriction: { forUser: async () => restrictionForNames(opts.restricted!) } } : {}) });
  const chat = (messages: ImportedMessage[]) => notes.create('u', { clientId: c.id, source: 'whatsapp_export', rawText: 'chat', audioKey: null, status: 'extracted', messages });
  return { svc, alerts, clients, c, chat };
}

describe('[P47-2] an alert reaching the rep', () => {
  it('the window is 7 days', () => { expect(WIN_BACK_WINDOW_DAYS).toBe(7); });

  it('a Today card shown for a client who IS going quiet records the alert (how many days silent, since when)', async () => {
    const s = await setup();
    await s.svc.recordShown('u', [s.c.id], SHOWN);
    expect(await s.alerts.listByUser('u')).toEqual([expect.objectContaining({ clientId: s.c.id, silentDays: 20, reachedAt: SHOWN, reachedVia: 'today', quietSince: SHOWN - 20 * DAY })]);
  });

  it('NEGATIVE: a client who is not going quiet is never recorded, whatever the app reports', async () => {
    const s = await setup();
    await s.clients.setLastTouched('u', s.c.id, SHOWN - 2 * DAY);
    await s.svc.recordShown('u', [s.c.id, 'not-my-client'], SHOWN);
    expect(await s.alerts.listByUser('u')).toEqual([]);
  });

  it('shown again in the same silence → still one alert (the first time it reached the rep); a new silence → a second alert', async () => {
    const s = await setup();
    await s.svc.recordShown('u', [s.c.id], SHOWN);
    await s.svc.recordShown('u', [s.c.id], SHOWN + DAY);
    expect((await s.alerts.listByUser('u')).map((a) => a.reachedAt)).toEqual([SHOWN]);
    await s.clients.setLastTouched('u', s.c.id, SHOWN + 10 * DAY);
    await s.svc.recordShown('u', [s.c.id], SHOWN + 30 * DAY);
    expect(await s.alerts.listByUser('u')).toHaveLength(2);
  });
});

describe('[P47-2] win-back entries', () => {
  it('the client writes back on day 7 → an entry with their message as the receipt', async () => {
    const s = await setup();
    await s.svc.recordShown('u', [s.c.id], SHOWN);
    await s.chat([msg(SHOWN + 7 * DAY - 60_000, 'client')]);
    const [e, ...rest] = await s.svc.entries('u');
    expect(rest).toEqual([]);
    expect(e).toMatchObject({ clientId: s.c.id, clientName: 'Sara Khan', flaggedAt: SHOWN, silentDays: 20, receipt: { quote: 'Hi, sorry for the delay, still interested' } });
    expect(e!.wroteBackAt).toBe(SHOWN + 7 * DAY - 60_000);
  });

  it('NEGATIVE: the first reply on day 8 → no entry', async () => {
    const s = await setup();
    await s.svc.recordShown('u', [s.c.id], SHOWN);
    await s.chat([msg(SHOWN + 7 * DAY + 3_600_000, 'client')]);
    expect(await s.svc.entries('u')).toEqual([]);
  });

  it('NEGATIVE: an alert that never reached the rep (no card shown, no push) → no entry', async () => {
    const s = await setup();
    await s.chat([msg(SHOWN + DAY, 'client')]);
    expect(await s.svc.entries('u')).toEqual([]);
  });

  it('NEGATIVE: only the rep wrote → no entry', async () => {
    const s = await setup();
    await s.svc.recordShown('u', [s.c.id], SHOWN);
    await s.chat([msg(SHOWN + DAY, 'rep', 'Hi Sara, checking in')]);
    expect(await s.svc.entries('u')).toEqual([]);
  });

  it('a chat imported 10 days later still counts when the message itself was sent within the 7 days', async () => {
    const s = await setup();
    await s.svc.recordShown('u', [s.c.id], SHOWN);
    // the import happens now (long after), but the client's message carries the time they sent it
    await s.chat([msg(SHOWN + 3 * DAY, 'client')]);
    expect(await s.svc.entries('u')).toHaveLength(1);
  });

  it('NEGATIVE: a message from before the alert does not count', async () => {
    const s = await setup();
    await s.svc.recordShown('u', [s.c.id], SHOWN);
    await s.chat([msg(SHOWN - DAY, 'client')]);
    expect(await s.svc.entries('u')).toEqual([]);
  });

  it('NEGATIVE: a message the rep held back from the record (excluded) does not count', async () => {
    const s = await setup();
    await s.svc.recordShown('u', [s.c.id], SHOWN);
    await s.chat([{ ...msg(SHOWN + DAY, 'client'), excluded: true }]);
    expect(await s.svc.entries('u')).toEqual([]);
  });

  it('NEGATIVE: a client under an erasure restriction is withheld', async () => {
    const s = await setup({ restricted: ['Sara Khan'] });
    await s.svc.recordShown('u', [s.c.id], SHOWN);
    await s.chat([msg(SHOWN + DAY, 'client')]);
    expect(await s.svc.entries('u')).toEqual([]);
  });

  it('a second silence and a second reply → a second entry', async () => {
    const s = await setup();
    await s.svc.recordShown('u', [s.c.id], SHOWN);
    await s.chat([msg(SHOWN + DAY, 'client')]);
    await s.clients.setLastTouched('u', s.c.id, SHOWN + DAY);
    await s.svc.recordShown('u', [s.c.id], SHOWN + 30 * DAY);
    await s.chat([msg(SHOWN + 31 * DAY, 'client')]);
    expect((await s.svc.entries('u')).map((e) => e.wroteBackAt)).toEqual([SHOWN + 31 * DAY, SHOWN + DAY]);
  });
});
