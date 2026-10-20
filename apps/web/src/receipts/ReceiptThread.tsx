import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { API_BASE } from '../apiBase.js';
import { formatBody } from '../format/dates.js';
import { HttpReceiptsClient, type Bubble, type ReceiptRef, type ReceiptSource, type ReceiptsApi } from './receiptsClient.js';

/**
 * [P35-3] THE receipt — every surface in Tovira that shows where something came from renders it here, as a
 * WhatsApp-style chat so a rep recognises it instantly:
 *  - the rep's own messages on REP_SIDE (one constant — flip it here), everyone else's on the other side;
 *  - rep bubbles on the tinted accent, others on the neutral surface; the tail on the first bubble of a run;
 *  - the sender's name above the bubble when the sender changes (and on every bubble of an unidentified chat),
 *    and always in the bubble's accessible text — side and colour are never the only signal;
 *  - the time inside the bubble ("10:20"); a centred date chip between days — the date shown once, never per
 *    bubble or under the receipt;
 *  - the source message outlined and labelled "Source message"; context messages dimmer;
 *  - compact (cards, list lines): only the source bubble; "Show the conversation" opens up to 3 either side,
 *    then "Show full conversation";
 *  - long text clamped to ~4 lines with "Read more" (CSS, so never cut inside a word or a timestamp);
 *  - dir="auto" per bubble text (Arabic reads RTL inside its bubble; the bubble's side never flips);
 *  - a voice note is a rep-side bubble with a mic, "Voice note"; a note with no sender is "Your note";
 *  - text exactly as stored (redaction unchanged).
 */
export const REP_SIDE: 'right' | 'left' = 'right';
const OTHER_SIDE: 'right' | 'left' = REP_SIDE === 'right' ? 'left' : 'right';

const ReceiptsContext = createContext<ReceiptsApi | null>(null);
let defaultApi: ReceiptsApi | null = null;
const fallbackApi = (): ReceiptsApi => (defaultApi ??= new HttpReceiptsClient(API_BASE));

export function ReceiptsProvider({ api, children }: { api: ReceiptsApi; children: ReactNode }): JSX.Element {
  return <ReceiptsContext.Provider value={api}>{children}</ReceiptsContext.Provider>;
}

const CLAMP_CHARS = 280;
const time = (at: string | null): string => (at && /T\d{2}:\d{2}/.test(at) ? at.slice(11, 16) : '');
const dayKey = (at: string | null): string | null => (at ? at.slice(0, 10) : null);

function fallbackSource(ref: ReceiptRef): ReceiptSource | null {
  const text = (ref.quote ?? ref.span ?? '').trim();
  if (!text) return null;
  return { kind: 'quote', noteId: ref.noteId ?? null, repKnown: false, hasMore: false, bubbles: [{ sender: ref.sender?.trim() || 'Source', side: 'other', at: ref.at ?? null, text, source: true }] };
}

export interface ReceiptThreadProps {
  /** Where the receipt came from: note + stored span + message time (and the quote to show while loading). */
  refInfo: ReceiptRef;
  /** Cards and list lines: only the source bubble until tapped. Default true. */
  compact?: boolean;
  /** Shown when there is no source at all ("No source quote was saved for this fact"). */
  emptyText?: string;
  /** Extra content revealed with the conversation (a kept suggestion's delivery message). */
  alsoOnExpand?: ReactNode;
  /** [P36-5] A whole conversation (by note id) instead of one receipt: the newest messages, newest day last,
   *  older pages loading as the rep scrolls up. Nothing is outlined — it is the chat, not a source. */
  conversation?: string;
}

export function ReceiptThread(props: ReceiptThreadProps): JSX.Element | null {
  return props.conversation ? <ConversationThread noteId={props.conversation} /> : <SourceThread {...props} />;
}

function SourceThread({ refInfo, compact = true, emptyText, alsoOnExpand }: ReceiptThreadProps): JSX.Element | null {
  const api = useContext(ReceiptsContext) ?? fallbackApi();
  const key = JSON.stringify(refInfo);
  const fallback = useMemo(() => fallbackSource(refInfo), [key]);
  const [source, setSource] = useState<ReceiptSource | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [full, setFull] = useState<ReceiptSource | null>(null);

  useEffect(() => {
    let live = true;
    setSource(null);
    setFull(null);
    if (refInfo.noteId || refInfo.clientId || refInfo.quote || refInfo.span) {
      void api.source(refInfo).then((s) => { if (live && s && s.bubbles.length > 0) setSource(s); }).catch(() => undefined);
    }
    return () => { live = false; };
  }, [api, key]);

  const shown = full ?? source ?? fallback;
  if (!shown) return emptyText ? <p data-testid="receipt-empty" className="tov-thread__empty">{emptyText}</p> : null;

  const open = !compact || expanded;
  const visible = open ? shown.bubbles : shown.bubbles.filter((b) => b.source).slice(0, 1);
  const list = visible.length > 0 ? visible : shown.bubbles.slice(0, 1);
  const named = shown.kind === 'chat' && !shown.repKnown; // an unidentified chat: name on every bubble

  async function showFull(): Promise<void> {
    const t = await api.thread(refInfo, true);
    if (t) setFull(t);
  }
  // A receipt with a note behind it may have a conversation even before its source has loaded — offer the tap
  // from the first render; tapping early loads the conversation around the source.
  const loading = source === null && !!refInfo.noteId;
  async function openEarly(): Promise<void> {
    setExpanded(true);
    const t = await api.thread(refInfo, false).catch(() => null);
    if (t && t.bubbles.length > 0) setSource(t);
  }

  return (
    <div className="tov-thread" data-testid="receipt-thread" role="figure" aria-label="Receipt">
      <div className="tov-thread__list">
        {list.map((b, i) => {
          const prev = list[i - 1];
          const day = dayKey(b.at);
          const newDay = day !== null && day !== dayKey(prev?.at ?? null);
          const runStart = !prev || prev.sender !== b.sender || newDay;
          return (
            <div key={`${i}:${b.at ?? ''}`} className="tov-thread__item">
              {newDay && <div className="tov-datechip" data-testid="date-chip">{formatBody(day)}</div>}
              <BubbleView bubble={b} showName={runStart || named} tail={runStart} dim={open && !b.source && shown.bubbles.some((x) => x.source)} />
            </div>
          );
        })}
      </div>
      {compact && !expanded && shown.bubbles.length > 1 && (
        <button type="button" className="tov-link tov-thread__more" aria-expanded={false} onClick={() => setExpanded(true)}>Show the conversation</button>
      )}
      {compact && !expanded && shown.bubbles.length <= 1 && loading && !alsoOnExpand && (
        <button type="button" className="tov-link tov-thread__more" aria-expanded={false} onClick={() => void openEarly()}>Show the conversation</button>
      )}
      {compact && !expanded && shown.bubbles.length <= 1 && (shown.hasMore || alsoOnExpand) && !(loading && !alsoOnExpand) && (
        <button type="button" className="tov-link tov-thread__more" aria-expanded={false} onClick={() => { setExpanded(true); if (shown.hasMore) void showFull(); }}>Show the conversation</button>
      )}
      {open && alsoOnExpand}
      {open && shown.hasMore && !full && (
        <button type="button" className="tov-link tov-thread__more" onClick={() => void showFull()}>Show full conversation</button>
      )}
    </div>
  );
}

/** [P36-5] One conversation, a page at a time — WhatsApp order (oldest at the top, newest at the bottom, opened
 *  at the bottom); scrolling to the top (or "Load earlier messages") fetches the page before. */
function ConversationThread({ noteId }: { noteId: string }): JSX.Element {
  const api = useContext(ReceiptsContext) ?? fallbackApi();
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [named, setNamed] = useState(false);
  const [from, setFrom] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const topRef = useRef<HTMLDivElement | null>(null);
  const keep = useRef<{ height: number; top: number } | null>(null);

  async function load(before?: number): Promise<void> {
    if (!api.conversation || loading) return;
    setLoading(true);
    const el = listRef.current;
    keep.current = before !== undefined && el ? { height: el.scrollHeight, top: el.scrollTop } : null;
    const page = await api.conversation(noteId, before).catch(() => null);
    setLoading(false);
    if (!page) { if (before === undefined) setFailed(true); return; }
    setNamed(page.source.kind === 'chat' && !page.source.repKnown);
    setBubbles((prev) => (before === undefined ? page.source.bubbles : [...page.source.bubbles, ...prev]));
    setFrom(page.from);
    setHasMore(page.source.hasMore);
  }

  useEffect(() => { void load(); }, [noteId]);
  // Opened at the newest message; after an older page is prepended, the rep stays where they were.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (keep.current) { el.scrollTop = el.scrollHeight - keep.current.height + keep.current.top; keep.current = null; }
    else el.scrollTop = el.scrollHeight;
  }, [bubbles]);
  // Scrolling up to the top loads the page before (where IntersectionObserver exists; the button always works).
  useEffect(() => {
    const top = topRef.current;
    if (!top || !hasMore || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting) && from !== null) void load(from); }, { root: listRef.current });
    io.observe(top);
    return () => io.disconnect();
  }, [hasMore, from]);

  return (
    <div className="tov-thread tov-thread--conversation" data-testid="receipt-thread" role="figure" aria-label="Conversation">
      {failed ? <p className="tov-thread__empty">This conversation couldn't be loaded. Try again later.</p> : (
        <div className="tov-thread__list tov-thread__list--scroll" ref={listRef}>
          <div ref={topRef} aria-hidden="true" />
          {hasMore && from !== null && (
            <button type="button" className="tov-link tov-thread__more" onClick={() => void load(from)} disabled={loading}>
              {loading ? 'Loading…' : 'Load earlier messages'}
            </button>
          )}
          {bubbles.map((b, i) => {
            const prev = bubbles[i - 1];
            const day = dayKey(b.at);
            const newDay = day !== null && day !== dayKey(prev?.at ?? null);
            const runStart = !prev || prev.sender !== b.sender || newDay;
            return (
              <div key={`${i}:${b.at ?? ''}`} className="tov-thread__item">
                {newDay && <div className="tov-datechip" data-testid="date-chip">{formatBody(day)}</div>}
                <BubbleView bubble={b} showName={runStart || named} tail={runStart} dim={false} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function BubbleView({ bubble: b, showName, tail, dim }: { bubble: Bubble; showName: boolean; tail: boolean; dim: boolean }): JSX.Element {
  const [more, setMore] = useState(false);
  const long = b.text.length > CLAMP_CHARS || b.text.split('\n').length > 4;
  const side = b.side === 'rep' ? REP_SIDE : OTHER_SIDE;
  const t = time(b.at);
  const label = [b.sender, b.voice ? 'voice note' : null, t || (b.at ? formatBody(b.at) : null), b.source ? 'Source message' : null].filter(Boolean).join(', ');
  return (
    <div
      className={['tov-bubble', `tov-bubble--${side}`, b.side === 'rep' ? 'tov-bubble--rep' : 'tov-bubble--other', b.source ? 'tov-bubble--source' : '', dim ? 'tov-bubble--context' : '', tail ? 'tov-bubble--tail' : ''].filter(Boolean).join(' ')}
      data-testid="bubble"
      data-side={side}
      data-source={b.source ? 'true' : 'false'}
      aria-label={label}
    >
      {showName && <div className="tov-bubble__name" data-testid="bubble-name">{b.sender}</div>}
      {b.voice && (
        <div className="tov-bubble__voice">
          <svg data-testid="mic" aria-hidden="true" width="12" height="12" viewBox="0 0 24 24"><path fill="currentColor" d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-2.1A7 7 0 0 0 19 12z" /></svg>
          <span>Voice note</span>
        </div>
      )}
      <div data-testid="bubble-text" dir="auto" className={`tov-bubble__text${long && !more ? ' tov-bubble__text--clamped' : ''}`}>{b.text}</div>
      {long && !more && <button type="button" className="tov-bubble__readmore" onClick={() => setMore(true)}>Read more</button>}
      {t && <span className="tov-bubble__time" data-testid="bubble-time">{t}</span>}
    </div>
  );
}
