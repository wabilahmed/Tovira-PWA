import { describe, it, expect } from 'vitest';
import { clientPromiseCopy, fieldCopy, keptCopy, noteCopy, repPromiseCopy, statusCopy, withAed, type CardCopy } from './cardCopy.js';

/** [P39-6] Every card: a question ending in "?", and a one-line consequence. The owner's five examples, exactly. */
const shape = (c: CardCopy) => {
  expect(c.question.endsWith('?')).toBe(true);
  expect(c.consequence).toMatch(/^Yes .+\.$/);
  expect(c.consequence).not.toMatch(/\n/);
  expect(c.yes).toBeTruthy();
  expect(c.no).toBeTruthy();
};

describe('[P39-6] card copy, one function per type', () => {
  it('budget', () => {
    const c = fieldCopy('Sara Khan', 'budget', '2.2M');
    shape(c);
    expect(c).toEqual({ question: "Did Sara Khan's budget change to AED 2.2M?", consequence: 'Yes updates their budget.', yes: 'Yes, update it', no: 'No' });
  });

  it('client promise', () => {
    const c = clientPromiseCopy('QA P14 Gate Client', 'Send ID photos');
    shape(c);
    expect(c).toEqual({ question: 'Did QA P14 Gate Client promise to send ID photos?', consequence: 'Yes adds it to their promises.', yes: 'Yes, track it', no: 'No' });
  });

  it('rep promise', () => {
    const c = repPromiseCopy('QA Ahmed Al Mansouri', 'Send the Arabian Ranches shortlist');
    shape(c);
    expect(c).toEqual({ question: 'Did you promise QA Ahmed Al Mansouri the Arabian Ranches shortlist?', consequence: 'Yes adds it to your promises.', yes: 'Yes, track it', no: 'No' });
    expect(repPromiseCopy('Omar', 'Call the developer').question).toBe("Did you promise Omar you'd call the developer?");
    expect(repPromiseCopy(null, 'Renew the trade licence').question).toBe('Did you promise to renew the trade licence?');
  });

  it('kept-promise suggestion', () => {
    const c = keptCopy('Looks like you sent the options.');
    shape(c);
    expect(c).toEqual({ question: 'Looks like you sent the options. Mark it done?', consequence: 'Yes closes the promise.', yes: 'Yes, mark done', no: 'Not yet' });
    // the server's own line ends "Mark done?" — replaced, never doubled
    expect(keptCopy('Looks like you sent the options to QA P14 Gate Client. Mark done?').question).toBe('Looks like you sent the options to QA P14 Gate Client. Mark it done?');
  });

  it('status suggestion', () => {
    const c = statusCopy('No reply in 31 days.', 'QA Enter Key Client', 'cold');
    shape(c);
    expect(c).toEqual({ question: 'No reply in 31 days. Mark QA Enter Key Client as Cold?', consequence: 'Yes sets their status to Cold.', yes: 'Mark cold', no: 'Keep warm' });
    shape(statusCopy('Marked lost in the chat.', 'Omar', 'done'));
  });

  it('a held note with no known field', () => {
    shape(noteCopy('Sara Khan'));
  });

  it('negative: never a guessed pronoun; budgets always carry AED, never twice', () => {
    for (const c of [fieldCopy('Sara Khan', 'budget', '2.2M'), clientPromiseCopy('Sara', 'Send it'), statusCopy('x', 'Sara', 'cold'), noteCopy('Sara')]) {
      expect(`${c.question} ${c.consequence}`).not.toMatch(/\b(her|his|she|he|him)\b/i);
    }
    expect(withAed('AED 3.4M')).toBe('AED 3.4M');
    expect(fieldCopy('Sara', 'budget', 'aed 3M').question).toBe("Did Sara's budget change to aed 3M?");
    expect(fieldCopy('Sara', 'email', 'sara@example.com').question).not.toMatch(/AED/);
  });
});
