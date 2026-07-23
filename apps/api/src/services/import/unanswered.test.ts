import { describe, it, expect } from 'vitest';
import { assignSpeakerRoles, detectUnansweredQuestions } from './unanswered.js';
import type { ImportedMessage } from '../../ports/note-repository.js';

const msg = (sender: string, body: string, extra: Partial<ImportedMessage> = {}): ImportedMessage => ({
  sentAt: '2026-01-15T09:00:00',
  sender,
  body,
  media: false,
  role: 'unknown',
  ...extra,
});

describe('assignSpeakerRoles (P1-6)', () => {
  it('tags the speaker matching the client name as client, the other as rep', () => {
    const tagged = assignSpeakerRoles(
      [msg('Sara Lee', 'hi'), msg('Alex (me)', 'hey')],
      'Sara Lee',
    );
    expect(tagged[0]!.role).toBe('client');
    expect(tagged[1]!.role).toBe('rep');
  });

  it('matches on first name when the export uses a shortened name', () => {
    const tagged = assignSpeakerRoles([msg('Sara', 'hi'), msg('Alex', 'hey')], 'Sara Lee');
    expect(tagged.find((m) => m.sender === 'Sara')!.role).toBe('client');
  });

  // When we can't confidently identify the client speaker, leave roles unknown
  // rather than guess — a wrong role could produce a false accusation.
  it('leaves roles unknown when no speaker matches the client name', () => {
    const tagged = assignSpeakerRoles([msg('Bob', 'hi'), msg('Alex', 'hey')], 'Sara Lee');
    expect(tagged.every((m) => m.role === 'unknown')).toBe(true);
  });
});

describe('detectUnansweredQuestions (P1-6)', () => {
  // POSITIVE: client asks and the thread ends → flagged, quoting the message.
  it('flags a client question when no rep reply follows it', () => {
    const messages = assignSpeakerRoles(
      [
        msg('Alex', 'Sending the quote today.'),
        msg('Sara Lee', 'Great. Can you do bulk pricing?', { sentAt: '2026-01-16T10:00:00' }),
      ],
      'Sara Lee',
    );
    const found = detectUnansweredQuestions(messages);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      question: 'Great. Can you do bulk pricing?',
      sender: 'Sara Lee',
      sentAt: '2026-01-16T10:00:00',
    });
  });

  // NEGATIVE: rep replies after the question → NOT flagged (no false accusations).
  it('does not flag a client question the rep answered afterwards', () => {
    const messages = assignSpeakerRoles(
      [
        msg('Sara Lee', 'Can you do bulk pricing?'),
        msg('Alex', 'Yes — 10% off above 500 units.'),
      ],
      'Sara Lee',
    );
    expect(detectUnansweredQuestions(messages)).toEqual([]);
  });

  // NEGATIVE: the rep's own trailing question is not a client question.
  it('ignores the rep\'s own questions', () => {
    const messages = assignSpeakerRoles(
      [
        msg('Sara Lee', 'Thanks!'),
        msg('Alex', 'Want me to send the deck?'),
      ],
      'Sara Lee',
    );
    expect(detectUnansweredQuestions(messages)).toEqual([]);
  });

  // NEGATIVE: a statement (no question mark) is not treated as a question.
  it('does not flag a non-question client message at the end', () => {
    const messages = assignSpeakerRoles(
      [msg('Alex', 'Here you go.'), msg('Sara Lee', 'Perfect, thanks.')],
      'Sara Lee',
    );
    expect(detectUnansweredQuestions(messages)).toEqual([]);
  });

  // NEGATIVE: with unknown roles we never flag (can't falsely accuse).
  it('never flags when roles are unknown', () => {
    const messages = [msg('Bob', 'Can you do bulk pricing?'), msg('Al', 'hmm')];
    expect(detectUnansweredQuestions(messages)).toEqual([]);
  });

  // A media-only "message" is not a question even if role is client.
  it('ignores media placeholders', () => {
    const messages = assignSpeakerRoles(
      [msg('Alex', 'ok'), msg('Sara Lee', '<Media omitted>', { media: true })],
      'Sara Lee',
    );
    expect(detectUnansweredQuestions(messages)).toEqual([]);
  });
});
