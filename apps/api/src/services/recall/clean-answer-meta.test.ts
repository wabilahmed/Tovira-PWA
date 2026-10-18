import { describe, it, expect } from 'vitest';
import { RecallService, cleanAnswer } from './recall-service.js';
import type { SimilarNote } from '../../ports/note-repository.js';

/** [P21-R4] The rep never reads the model talking about its "excerpts" / "provided notes". A meta sentence
 *  is dropped, a meta lead-in is cut off; an answer that was only meta becomes our honest NO_ANSWER. */
describe('[P21-R4] cleanAnswer strips every "the excerpts…" variant', () => {
  const gone: string[] = [
    'The excerpts provided do not contain any information about parking.',
    'The excerpts do not mention a budget.',
    "The excerpts don't say when the viewing is.",
    'There is no mention of parking in the provided notes.',
    "The provided context doesn't include Sara's budget.",
    'None of the excerpts mention a deadline.',
    "I don't see anything about parking in the excerpts.",
    'The information provided does not specify a date.',
    'Based on the excerpts provided, there is no information about parking.',
    'The excerpt does not contain that.',
  ];
  for (const t of gone) it(`drops: "${t}"`, () => expect(cleanAnswer(t)).toBe(''));

  it('keeps the answer, drops the trailing meta sentence', () => {
    expect(cleanAnswer('QA P14 Gate Client asked about parking. The excerpts provided do not mention any other client.')).toBe('QA P14 Gate Client asked about parking.');
  });
  it('cuts a meta lead-in and recapitalises', () => {
    expect(cleanAnswer('In the excerpts provided, Gate Client asked about parking.')).toBe('Gate Client asked about parking.');
    expect(cleanAnswer('The excerpts show that Gate Client asked about parking.')).toBe('Gate Client asked about parking.');
  });
  it('NEGATIVE: ordinary content that uses "information provided by …" is untouched', () => {
    expect(cleanAnswer('Sara said the information provided by the developer was wrong.')).toBe('Sara said the information provided by the developer was wrong.');
    expect(cleanAnswer('Ahmed has not mentioned parking.')).toBe('Ahmed has not mentioned parking.');
  });

  it('an all-meta model answer becomes the honest "I don\'t have that on record."', async () => {
    const note = { id: 'n1', userId: 'u', clientId: 'c', source: 'paste', rawText: 'Gate client needs two parking spots', audioKey: null, status: 'extracted', sweepAttempts: 0, extracted: null, messages: null, createdAt: Date.parse('2026-04-01') };
    const svc = new RecallService({ dimension: 8, embed: async () => [1, 0, 0, 0, 0, 0, 0, 0] }, { searchSimilarByUser: async (): Promise<SimilarNote[]> => [{ note: note as never, similarity: 0.9 }] } as never,
      { complete: async () => ({ text: 'The excerpts provided do not contain information about a deadline.' }) });
    expect((await svc.ask('u', 'deadline?')).answer).toBe("I don't have that on record.");
  });
});
