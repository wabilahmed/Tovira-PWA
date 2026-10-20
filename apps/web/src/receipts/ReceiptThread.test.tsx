import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReceiptThread, ReceiptsProvider, REP_SIDE } from './ReceiptThread.js';
import type { Bubble, ReceiptSource, ReceiptsApi } from './receiptsClient.js';

/**
 * [P35-3] Every receipt in Tovira renders as a WhatsApp-style chat: the rep's messages on the rep side, everyone
 * else's on the other; the name above a bubble when the sender changes (always for non-rep senders); the time
 * inside the bubble; a centred date chip between days (the date shown once); the source message highlighted and
 * labelled; compact places show only the source bubble and a tap opens up to 3 either side, then the full
 * conversation; voice notes and "Your note" are rep-side bubbles; an unidentified chat puts everyone on one
 * side, named; text is dir="auto"; no ISO dates anywhere.
 */
const b = (o: Partial<Bubble> & { text: string }): Bubble => ({ sender: 'Sara Khan', side: 'other', at: '2026-03-02T10:00', source: false, ...o });
const WINDOW: Bubble[] = [
  b({ text: 'Hello', at: '2026-03-01T09:00' }),
  b({ text: 'Hi Sara', sender: 'Wabil', side: 'rep', at: '2026-03-01T09:05' }),
  b({ text: 'Any news on the villa?', at: '2026-03-02T10:00' }),
  b({ text: "Great, I'll send you the floor plans tomorrow", sender: 'Wabil', side: 'rep', at: '2026-03-02T10:20', source: true }),
  b({ text: 'Thanks', at: '2026-03-02T10:25' }),
  b({ text: 'Morning', at: '2026-03-03T08:00' }),
  b({ text: 'Call me later', at: '2026-03-03T08:15' }),
];
const chat = (bubbles: Bubble[], o: Partial<ReceiptSource> = {}): ReceiptSource => ({ kind: 'chat', noteId: 'n1', repKnown: true, bubbles, hasMore: true, ...o });
function api(source: ReceiptSource, full?: ReceiptSource): ReceiptsApi & { thread: ReturnType<typeof vi.fn> } {
  return { source: vi.fn().mockResolvedValue(source), thread: vi.fn().mockResolvedValue(full ?? source) } as never;
}
const REF = { noteId: 'n1', span: "I'll send you the floor plans tomorrow", at: '2026-03-02T10:20', quote: "I'll send you the floor plans tomorrow" };
const renderIn = (a: ReceiptsApi, el: JSX.Element) => render(<ReceiptsProvider api={a}>{el}</ReceiptsProvider>);
const bubbles = () => screen.getAllByTestId('bubble');

describe('[P35-3] <ReceiptThread>', () => {
  it('the rep\'s message is on the rep side, the client\'s on the other (REP_SIDE is one constant)', async () => {
    renderIn(api(chat(WINDOW)), <ReceiptThread refInfo={REF} compact={false} />);
    await screen.findAllByTestId('bubble');
    const rep = bubbles().find((x) => x.textContent?.includes('floor plans'))!;
    const client = bubbles().find((x) => x.textContent?.includes('Thanks'))!;
    expect(rep).toHaveAttribute('data-side', REP_SIDE);
    expect(client).toHaveAttribute('data-side', REP_SIDE === 'right' ? 'left' : 'right');
  });

  it('the source message is highlighted and labelled "Source message"; context bubbles are not', async () => {
    renderIn(api(chat(WINDOW)), <ReceiptThread refInfo={REF} compact={false} />);
    await screen.findAllByTestId('bubble');
    const src = bubbles().filter((x) => x.getAttribute('data-source') === 'true');
    expect(src).toHaveLength(1);
    expect(src[0]!.getAttribute('aria-label')).toMatch(/Source message/);
    expect(bubbles().filter((x) => /Source message/.test(x.getAttribute('aria-label') ?? ''))).toHaveLength(1);
  });

  it('compact renders exactly one bubble; a tap opens no more than 3 either side, then "Show full conversation"', async () => {
    const full = chat([...WINDOW, b({ text: 'Later message', at: '2026-03-04T09:00' })], { hasMore: false });
    const a = api(chat(WINDOW), full);
    renderIn(a, <ReceiptThread refInfo={REF} />);
    await waitFor(() => expect(bubbles()).toHaveLength(1));
    expect(bubbles()[0]).toHaveTextContent('floor plans');
    await userEvent.click(screen.getByRole('button', { name: /show the conversation/i }));
    const shown = bubbles();
    const i = shown.findIndex((x) => x.getAttribute('data-source') === 'true');
    expect(i).toBeLessThanOrEqual(3);
    expect(shown.length - i - 1).toBeLessThanOrEqual(3);
    await userEvent.click(screen.getByRole('button', { name: 'Show full conversation' }));
    await waitFor(() => expect(bubbles()).toHaveLength(8));
    expect(a.thread).toHaveBeenCalledWith(expect.objectContaining({ noteId: 'n1' }), true);
  });

  it('a date chip between days, each date shown once; the time sits inside the bubble; no ISO anywhere', async () => {
    const { container } = renderIn(api(chat(WINDOW)), <ReceiptThread refInfo={REF} compact={false} />);
    await screen.findAllByTestId('bubble');
    expect(screen.getAllByTestId('date-chip').map((c) => c.textContent)).toEqual(['1 Mar 2026', '2 Mar 2026', '3 Mar 2026']);
    expect(container.textContent!.match(/2 Mar 2026/g)).toHaveLength(1);
    expect(within(bubbles()[3]!).getByTestId('bubble-time')).toHaveTextContent('10:20');
    expect(container.textContent).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it('the name shows above a bubble when the sender changes, and is in every bubble\'s accessible text', async () => {
    renderIn(api(chat(WINDOW)), <ReceiptThread refInfo={REF} compact={false} />);
    await screen.findAllByTestId('bubble');
    for (const x of bubbles()) expect(x.getAttribute('aria-label')).toMatch(/^(Sara Khan|Wabil)/);
    expect(screen.getAllByTestId('bubble-name').map((n) => n.textContent)).toEqual(['Sara Khan', 'Wabil', 'Sara Khan', 'Wabil', 'Sara Khan', 'Sara Khan']);
  });

  it('a voice note is a rep-side bubble with a mic and "Voice note"; a note with no sender reads "Your note"', async () => {
    const voice: ReceiptSource = { kind: 'voice', noteId: 'v', repKnown: true, hasMore: false, bubbles: [b({ sender: 'Voice note', side: 'rep', voice: true, source: true, text: 'She needs parking', at: '2026-10-19' })] };
    renderIn(api(voice), <ReceiptThread refInfo={{ noteId: 'v' }} />);
    const v = await screen.findByTestId('bubble');
    expect(v).toHaveAttribute('data-side', REP_SIDE);
    expect(v).toHaveTextContent('Voice note');
    expect(within(v).getByTestId('mic')).toBeInTheDocument();
  });

  it('"Your note" for a pasted / Ask note', async () => {
    const note: ReceiptSource = { kind: 'note', noteId: 'p', repKnown: true, hasMore: false, bubbles: [b({ sender: 'Your note', side: 'rep', source: true, text: 'Remember that Sara increased her budget to 2.2M', at: '2026-10-19' })] };
    renderIn(api(note), <ReceiptThread refInfo={{ noteId: 'p' }} />);
    const n = await screen.findByTestId('bubble');
    expect(n).toHaveAttribute('data-side', REP_SIDE);
    expect(n.getAttribute('aria-label')).toMatch(/^Your note/);
  });

  it('an unidentified-rep chat puts everyone on one side, every bubble named', async () => {
    const group = chat(WINDOW.map((x) => ({ ...x, side: 'other' as const })), { repKnown: false });
    renderIn(api(group), <ReceiptThread refInfo={REF} compact={false} />);
    await screen.findAllByTestId('bubble');
    expect(new Set(bubbles().map((x) => x.getAttribute('data-side'))).size).toBe(1);
    expect(screen.getAllByTestId('bubble-name')).toHaveLength(bubbles().length);
  });

  it('bubble text is dir="auto" (Arabic reads right-to-left inside its bubble; the side does not flip)', async () => {
    renderIn(api(chat([b({ text: 'أريد فيلا في مردف', source: true })])), <ReceiptThread refInfo={REF} />);
    await screen.findByText('أريد فيلا في مردف'); // the resolved source, not the loading placeholder
    const x = screen.getByTestId('bubble');
    expect(within(x).getByTestId('bubble-text')).toHaveAttribute('dir', 'auto');
    expect(x).toHaveAttribute('data-side', REP_SIDE === 'right' ? 'left' : 'right');
  });

  it('a long message is clamped with "Read more" — never cut inside a word', async () => {
    const long = 'word '.repeat(120).trim();
    renderIn(api(chat([b({ text: long, source: true })])), <ReceiptThread refInfo={REF} />);
    await screen.findByText(long); // the resolved source, not the loading placeholder
    const x = screen.getByTestId('bubble');
    expect(within(x).getByTestId('bubble-text')).toHaveTextContent(long); // the full text, clamped by CSS — not cut
    expect(within(x).getByTestId('bubble-text')).toHaveClass('tov-bubble__text--clamped');
    await userEvent.click(within(x).getByRole('button', { name: 'Read more' }));
    expect(within(x).getByTestId('bubble-text')).not.toHaveClass('tov-bubble__text--clamped');
  });

  it('while the source loads (or if it can\'t), the stored quote shows as a bubble — never blank', () => {
    const slow: ReceiptsApi = { source: () => new Promise(() => {}), thread: vi.fn() };
    renderIn(slow, <ReceiptThread refInfo={{ ...REF, sender: 'Sara Khan' }} />);
    expect(screen.getByTestId('bubble')).toHaveTextContent("I'll send you the floor plans tomorrow");
  });
});
