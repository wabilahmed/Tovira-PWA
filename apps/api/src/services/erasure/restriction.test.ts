import { describe, it, expect } from 'vitest';
import { restrictionForNames, NO_RESTRICTION, RestrictionService } from './restriction.js';
import { restrictNote, noteIsAboutRestricted } from './restrict-note.js';
import { InMemoryErasureRequestRepository } from '../../adapters/erasure/in-memory-erasure-request-repository.js';
import type { NoteRecord } from '../../ports/note-repository.js';

const note = (over: Partial<NoteRecord> = {}): NoteRecord => ({
  id: 'n1', userId: 'u', clientId: 'c1', source: 'whatsapp_export', rawText: 'raw', audioKey: null,
  status: 'extracted', sweepAttempts: 0, messages: null, extracted: null, createdAt: 0, ...over,
});

describe('[TASK 2] restriction scope', () => {
  it('restrictsWho matches exact and fuzzy (shared whole word); restrictsText matches a free-text mention', () => {
    const r = restrictionForNames(['Khalid Al Farsi']);
    expect(r.active).toBe(true);
    expect(r.restrictsWho('Khalid Al Farsi')).toBe(true); // exact
    expect(r.restrictsWho('Khalid')).toBe(true); // fuzzy (shared word)
    expect(r.restrictsWho('Omar')).toBe(false);
    expect(r.restrictsText("we met Khalid's brother")).toBe(true);
    expect(r.restrictsText('we met Omar')).toBe(false);
  });

  it('an empty name set is the no-op restriction', () => {
    expect(restrictionForNames([]).active).toBe(false);
    expect(restrictionForNames(['   ']).active).toBe(false);
    expect(NO_RESTRICTION.active).toBe(false);
  });
});

describe('[TASK 2] restrictNote transform', () => {
  const r = restrictionForNames(['Khalid']);

  it('drops the restricted sender\'s messages and keeps the rest', () => {
    const n = note({ messages: [
      { sentAt: null, sender: 'Khalid', body: 'secret', media: false, role: 'client' },
      { sentAt: null, sender: 'Rep', body: 'ok', media: false, role: 'rep' },
    ] });
    const v = restrictNote(n, r);
    expect(v.messages!.map((m) => m.sender)).toEqual(['Rep']);
    // the stored note is untouched
    expect(n.messages).toHaveLength(2);
  });

  it('strips the restricted party from the structured who-fields but keeps free-text mentions', () => {
    const n = note({ extracted: {
      people: [{ name: 'Khalid' }, { name: 'Omar' }],
      personal_facts: [{ subject: 'Khalid', fact: 'x' }, { subject: 'Omar', fact: 'y' }],
      unanswered_questions: [{ sender: 'Khalid', question: 'q' }],
      promises: [{ subject: 'Omar', text: 'call Khalid back' }], // MENTIONS Khalid → kept
      concerns: ['worried about Khalid'],
    } });
    const v = restrictNote(n, r).extracted as Record<string, unknown[]>;
    expect((v.people as Array<{ name: string }>).map((p) => p.name)).toEqual(['Omar']);
    expect((v.personal_facts as Array<{ subject: string }>).map((p) => p.subject)).toEqual(['Omar']);
    expect(v.unanswered_questions).toHaveLength(0);
    expect(v.promises).toHaveLength(1); // mention kept
    expect(v.concerns).toEqual(['worried about Khalid']); // mention kept
  });

  it('withholds the rendered/raw text of a note that is ENTIRELY the restricted party', () => {
    const msgOnly = note({ rawText: 'Khalid: secret', messages: [{ sentAt: null, sender: 'Khalid', body: 'secret', media: false, role: 'client' }] });
    expect(restrictNote(msgOnly, r).rawText).toBeNull();
    expect(restrictNote(msgOnly, r).messages).toHaveLength(0);

    const voiceAbout = note({ source: 'voice', messages: null, rawText: 'a voice note about Khalid', extracted: { people: [{ name: 'Khalid' }] } });
    expect(restrictNote(voiceAbout, r).rawText).toBeNull();

    const voiceOther = note({ source: 'voice', messages: null, rawText: 'a voice note about Omar', extracted: { people: [{ name: 'Omar' }] } });
    expect(restrictNote(voiceOther, r).rawText).toBe('a voice note about Omar');
  });

  it('is a no-op when nothing is restricted', () => {
    const n = note({ messages: [{ sentAt: null, sender: 'Khalid', body: 'x', media: false, role: 'client' }] });
    expect(restrictNote(n, NO_RESTRICTION)).toBe(n);
    expect(noteIsAboutRestricted(n, NO_RESTRICTION)).toBe(false);
  });
});

describe('[TASK 2] RestrictionService.forUser', () => {
  it('is active only while a request is pending/retention_asserted, and lifts on reject/withdraw/complete', async () => {
    const requests = new InMemoryErasureRequestRepository();
    const svc = new RestrictionService({ requests });
    const req = await requests.create('u', { requesterNames: ['Khalid'], requestedAt: 0, windowEndsAt: 10 });

    expect((await svc.forUser('u')).active).toBe(true); // pending
    await requests.setStatus('u', req.id, 'retention_asserted');
    expect((await svc.forUser('u')).active).toBe(true);
    await requests.setStatus('u', req.id, 'rejected');
    expect((await svc.forUser('u')).active).toBe(false); // lifted
    // a different rep is never restricted by this one's request
    expect((await svc.forUser('other')).active).toBe(false);
  });
});
