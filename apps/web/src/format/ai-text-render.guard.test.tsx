import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { PointersCard } from '../clients/PointersCard.js';
import { BriefOpenPromises } from '../brief/BriefOpenPromises.js';
import { BriefPanel } from '../App.js';
import { WantsSection, PromisesSection } from '../clients/page/Sections.js';

/**
 * [P46-4] Guard: model-written text reaches the screen without an em-dash. Each surface that shows a pointer, a brief
 * field or a promise's wording is rendered with dashed text, and the DOM must not contain "—" outside a receipt
 * (receipts are the client's own words and stay verbatim).
 */
vi.mock('../receipts/ReceiptThread.js', () => ({ ReceiptThread: () => <blockquote data-receipt>verbatim — receipt</blockquote> }));
const DASHED = 'Budget approved for July — anchor the next meeting on the payment plan';
const visible = (root: HTMLElement): string => {
  const c = root.cloneNode(true) as HTMLElement;
  c.querySelectorAll('[data-receipt]').forEach((n) => n.remove());
  return c.textContent ?? '';
};

describe('[P46-4] no em-dash in rendered AI text', () => {
  it('pointers and their disclosure', () => {
    const { container } = render(<PointersCard clientName="Sara" pointers={[{ section: 'relationship', text: DASHED, receipts: [{ source_span: 'x', source_message_at: null }] }, { section: 'close', text: 'Wants a villa — ideally Mirdif', receipts: [] }]} disclosure="We think — on balance — price was the issue" />);
    expect(visible(container)).not.toContain('—');
    expect(container.textContent).toContain('verbatim — receipt'); // the receipt is untouched
  });

  it('the brief: items to confirm, concerns, personal notes, open promises', () => {
    const { container } = render(<BriefPanel brief={{ clientName: 'Sara', empty: false, openPromises: [{ id: 'p1', text: DASHED, dueDate: null, dueRaw: null }], needsConfirmation: [{ id: 'q1', text: DASHED }], keyPeople: [{ name: 'Ahmed', role: 'husband — co-buyer', decision_role: 'decision_maker' }], personalNotes: [{ subject: 'family', fact: DASHED }], concerns: [DASHED], relatedNotes: [] }} onChange={vi.fn()} />);
    expect(visible(container)).not.toContain('—');
  });

  it('open promises in the brief', () => {
    const { container } = render(<BriefOpenPromises promises={[{ id: 'p1', text: DASHED, dueDate: null, dueRaw: null }]} />);
    expect(visible(container)).not.toContain('—');
  });

  it('the client page: what they want and their promises', () => {
    const overview = {
      lastMessageAt: null, openPromises: 1, overduePromises: 0, nextMeeting: null, meetingsCount: 0, conversations: [], statusSuggestion: null,
      wants: { summary: 'Villa', listLine: 'Villa', budgets: [], items: [{ id: 'r1', text: 'A villa — ideally Mirdif', quote: 'q', noteId: 'n1', statedOn: null }] },
      promises: [{ id: 'p1', clientId: 'c1', text: DASHED, owner: 'rep', dueDate: null, dueRaw: null, confidence: 'high', done: false, confirmed: true, overdue: false, stale: false }],
    } as unknown as Parameters<typeof WantsSection>[0]['overview'];
    for (const ui of [<WantsSection overview={overview} />, <PromisesSection overview={overview} clientName="Sara" clientId="c1" />]) {
      const { container, unmount } = render(ui);
      expect(visible(container)).not.toContain('—');
      unmount();
    }
  });
});
