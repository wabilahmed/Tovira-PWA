import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { BriefPanel } from '../App.js';
import type { Brief } from './clientsClient.js';

/**
 * [P69 · owner] The pre-meeting brief opens with "What they care about" (it used to keep personal notes at the
 * bottom, under "Personal notes", with no source). Each detail shows the message it came from; the pointers,
 * including "Closing the sale", stay below it.
 */
const BRIEF = {
  clientName: 'Layla Haddad', empty: false, recentContext: [], openPromises: [], needsConfirmation: [], keyPeople: [],
  personalNotes: [{ subject: 'Layla', fact: 'Loves the beach, goes every morning before work' }], concerns: [], relatedNotes: [],
  caresAbout: [
    { kind: 'detail', text: 'Loves the beach, goes every morning before work', subject: null, noteId: 'n1', quote: 'I love the beach, I go every morning before work', at: '2026-11-10T18:03' },
    { kind: 'ask', text: 'A 2-bed, budget around 3.2M', subject: null, noteId: 'n1', quote: 'Budget around 3.2M, 2 bed ideally', at: '2026-11-10' },
  ],
  pointers: [{ section: 'close', text: 'Line up the Saturday viewings she agreed to', receipts: [] }],
  pointersDisclosure: null,
} as unknown as Brief;

describe('[P69] the brief leads with what the client cares about', () => {
  it('first section, each item with its source message; no separate "Personal notes"', () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));
    render(<BriefPanel brief={BRIEF} onChange={vi.fn()} />);
    const cares = screen.getByTestId('brief-cares');
    expect(cares).toHaveTextContent('What they care about');
    expect(within(cares).getByText('Loves the beach, goes every morning before work')).toBeInTheDocument();
    expect(cares).toHaveTextContent('I love the beach, I go every morning before work');
    expect(screen.queryByText('Personal notes')).toBeNull();
    const text = document.body.textContent!;
    expect(text.indexOf('What they care about')).toBeLessThan(text.indexOf('Closing the sale'));
    vi.unstubAllGlobals();
  });
});
