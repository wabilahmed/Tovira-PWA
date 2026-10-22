import { hapticTick } from '../haptics.js';
import { useEffect, useRef, useState } from 'react';
import type { OpenPromise } from '../promises/promisesClient.js';
import { AnswerCard, DateCard } from './ConfirmChit.js';
import { clientPromiseCopy, dateCopy, fieldCopy, keptCopy, noteCopy, repPromiseCopy, shortDay, statusCopy } from './cardCopy.js';
import type { PendingCapture } from '../recall/recallClient.js';
import { ReceiptThread } from '../receipts/ReceiptThread.js';
import { Button } from '../ui/Button.js';
import { Section } from '../ui/layout.js';
import { Page, PageHeader } from '../ui/PageHeader.js';
import { EmptyState, Toast } from '../ui/feedback.js';
import type { KeptSuggestion } from '../promises/promisesClient.js';

/** The subset of the promises client the confirmation queue needs. */
export interface ConfirmQueueApi {
  listConfirmations(): Promise<OpenPromise[]>;
  confirm(id: string): Promise<boolean>;
  reject(id: string): Promise<boolean>;
}

/** [P21-A3] Statements held from Ask ("Remember that …") — confirmed through the capture endpoints. */
export interface CaptureQueueApi {
  listCaptures(): Promise<PendingCapture[]>;
  confirmCapture(noteId: string): Promise<boolean>;
  rejectCapture(noteId: string): Promise<boolean>;
}

/** [P24-2] "Looks like you sent it — Mark done?" — a delivery seen in the chat; only the rep closes it. */
export interface KeptQueueApi {
  listKept(): Promise<KeptSuggestion[]>;
  markKeptDone(id: string): Promise<boolean>;
  undoKept(id: string): Promise<boolean>;
  notYetKept(id: string): Promise<boolean>;
}

/** How long the "Marked done. Undo" toast stays (same as Delete's undo window). */
const KEPT_UNDO_MS = 10_000;

/**
 * The confirmation queue, surfaced inline wherever the rep lands — Today, Alerts,
 * the Monday Statement. Self-fetching and self-emptying: it renders nothing when
 * there is nothing to confirm, so a clean queue leaves no trace. Confirm turns a
 * guess into a fact; Not right removes it — a wrong fact is worse than a missing
 * one.
 */
/** [P36-7] What the existing inference would change (gone quiet → Cold; lost_inferred → Done, lost). Shown as a
 *  question; nothing changes until the rep answers. `keep` is the rep saying it's still alive. */
export interface StatusSuggestionCard { clientId: string; clientName: string; status: 'cold' | 'done'; outcome?: 'lost'; reason: string }
export interface StatusSuggestionsApi {
  list(): Promise<StatusSuggestionCard[]>;
  apply(s: StatusSuggestionCard): Promise<boolean>;
  keep(s: StatusSuggestionCard): Promise<boolean>;
}

/** [P40-1] Promises whose date the rep gives (the resolver couldn't read the phrase). */
export interface DateConfirmApi {
  listDatesToConfirm(): Promise<OpenPromise[]>;
  answerDate(id: string, answer: { dueDate: string } | { dateStatus: 'not_sure' | 'no_due_date' }): Promise<boolean>;
}

export function ConfirmChitQueue({ api, heading = 'Needs your answer', captures, kept, statusSuggestions, dates, limit, onSeeAll, standalone = false, back }: {
  api: ConfirmQueueApi;
  heading?: string;
  captures?: CaptureQueueApi;
  kept?: KeptQueueApi;
  /** [P36-7] status suggestions from the existing inference — "Mark … as Cold?" */
  statusSuggestions?: StatusSuggestionsApi;
  /** [P40-1] dates to confirm — "When is the floor plans promise due?" */
  dates?: DateConfirmApi;
  /** [P34-3] Show at most this many cards (newest first) and a "See all N" link — Today uses 3. */
  limit?: number;
  /** [P34-3] Opens the full To Confirm screen. */
  onSeeAll?: () => void;
  /** [P34-3] The dedicated To Confirm screen: says so when there is nothing to confirm (instead of vanishing). */
  standalone?: boolean;
  /** [P39-6] The full screen's back control ("← Today"). */
  back?: { label: string; onBack: () => void };
}): JSX.Element | null {
  const [items, setItems] = useState<OpenPromise[]>([]);
  const [held, setHeld] = useState<PendingCapture[]>([]);
  const [looksSent, setLooksSent] = useState<KeptSuggestion[]>([]);
  const [undoKept, setUndoKept] = useState<KeptSuggestion | null>(null);
  const [statusCards, setStatusCards] = useState<StatusSuggestionCard[]>([]);
  const [dateCards, setDateCards] = useState<OpenPromise[]>([]);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (undoTimer.current) clearTimeout(undoTimer.current); }, []);

  useEffect(() => {
    let live = true;
    void api.listConfirmations().then((x) => {
      if (live) setItems(x);
    });
    if (captures) void captures.listCaptures().then((x) => { if (live) setHeld(x); });
    if (kept) void kept.listKept().then((x) => { if (live) setLooksSent(x); });
    if (statusSuggestions) void statusSuggestions.list().then((x) => { if (live) setStatusCards(x); });
    if (dates) void dates.listDatesToConfirm().then((x) => { if (live) setDateCards(x); });
    return () => {
      live = false;
    };
  }, [api, captures, kept, statusSuggestions, dates]);

  async function answerDate(p: OpenPromise, a: { dueDate: string } | { dateStatus: 'not_sure' | 'no_due_date' }): Promise<void> {
    if (dates && (await dates.answerDate(p.id, a))) {
      if ('dueDate' in a) hapticTick();
      setDateCards((prev) => prev.filter((x) => x.id !== p.id));
    }
  }

  async function answerStatus(s: StatusSuggestionCard, take: boolean): Promise<void> {
    if (!statusSuggestions) return;
    if (await (take ? statusSuggestions.apply(s) : statusSuggestions.keep(s))) {
      if (take) hapticTick();
      setStatusCards((prev) => prev.filter((x) => x.clientId !== s.clientId));
    }
  }

  // [P24-2] Mark done → closed now, undoable for 10s; Not yet → dismissed (no undo needed: nothing changed).
  async function markKept(s: KeptSuggestion): Promise<void> {
    if (!kept || !(await kept.markKeptDone(s.id))) return;
    hapticTick();
    setLooksSent((prev) => prev.filter((x) => x.id !== s.id));
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndoKept(s);
    undoTimer.current = setTimeout(() => setUndoKept(null), KEPT_UNDO_MS);
  }
  async function undoMarkKept(): Promise<void> {
    const s = undoKept;
    if (!kept || !s) return;
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndoKept(null);
    if (await kept.undoKept(s.id)) setLooksSent((prev) => [s, ...prev]);
  }
  async function notYet(s: KeptSuggestion): Promise<void> {
    if (kept && (await kept.notYetKept(s.id))) setLooksSent((prev) => prev.filter((x) => x.id !== s.id));
  }

  const total = items.length + held.length + looksSent.length + statusCards.length + dateCards.length;
  const header = standalone ? (
    <PageHeader title="Needs your answer" subtitle={total === 0 ? 'Nothing to answer' : `${total} to answer`} back={back} />
  ) : null;
  if (total === 0 && !undoKept) {
    return standalone ? <Page testId="confirm-page" label="Needs your answer">{header}<EmptyState title="Nothing to answer." data-testid="confirm-empty">When Tovira isn't sure about something, it asks you here.</EmptyState></Page> : null;
  }

  const dropHeld = (noteId: string) => setHeld((prev) => prev.filter((c) => c.noteId !== noteId));
  async function resolveHeld(noteId: string, action: 'confirm' | 'reject'): Promise<void> {
    if (!captures) return;
    const ok = action === 'confirm' ? await captures.confirmCapture(noteId) : await captures.rejectCapture(noteId);
    if (ok) {
      if (action === 'confirm') hapticTick();
      dropHeld(noteId);
    }
  }

  const drop = (id: string) => setItems((prev) => prev.filter((p) => p.id !== id));
  async function confirm(id: string): Promise<void> {
    if (await api.confirm(id)) {
      hapticTick(); // a guess became a fact — a commit
      drop(id);
    }
  }
  async function reject(id: string): Promise<void> {
    if (await api.reject(id)) drop(id);
  }

  // [P34-3] One list across the kinds, newest first; Today shows the first `limit` and links to the rest.
  // [P39-6] Each card asks its question (cardCopy.ts), says what Yes does, shows its receipt, then the answers.
  const entries: Array<{ key: string; at: number; node: JSX.Element }> = [
    ...looksSent.map((s) => ({
      key: `kept:${s.id}`,
      at: s.createdAt ?? 0,
      node: (
        <AnswerCard
          key={`kept:${s.id}`}
          label="Looks sent — confirm"
          copy={keptCopy(s.message)}
          // [P34-7 → P35-3] the promise as a chat bubble; a tap opens the conversation AND the delivery message
          source={<ReceiptThread
            refInfo={{ noteId: s.noteId ?? null, clientId: s.clientId, span: s.promise.quote, at: s.promiseAt ?? s.promise.date, quote: s.promise.quote, sender: s.clientName }}
            alsoOnExpand={
              <ReceiptThread compact={false} refInfo={{ noteId: s.noteId ?? null, clientId: s.clientId, span: s.delivery.quote, at: s.deliveryAt ?? s.delivery.date, quote: s.delivery.quote }} />
            }
          />}
          onYes={() => void markKept(s)}
          onNo={() => void notYet(s)}
        />
      ),
    })),
    ...held.map((c) => ({
      key: `capture:${c.noteId}`,
      at: c.capturedAt ?? 0,
      node: (
        <AnswerCard
          key={`capture:${c.noteId}`}
          copy={c.field && c.value ? fieldCopy(c.clientName, c.field, c.value) : noteCopy(c.clientName)}
          source={<ReceiptThread refInfo={{ noteId: c.noteId, quote: c.statement, at: new Date(c.capturedAt).toISOString().slice(0, 10), sender: 'Your note' }} />}
          onYes={() => void resolveHeld(c.noteId, 'confirm')}
          onNo={() => void resolveHeld(c.noteId, 'reject')}
        />
      ),
    })),
    ...items.map((p) => ({
      key: p.id,
      at: p.createdAt ?? 0,
      node: (
        <AnswerCard
          key={p.id}
          copy={p.owner === 'client' && p.clientName ? clientPromiseCopy(p.clientName, p.text) : repPromiseCopy(p.clientName ?? null, p.text)}
          source={<ReceiptThread
            refInfo={p.receipt?.quote ? { noteId: p.noteId ?? null, clientId: p.clientId, span: p.sourceSpan ?? p.receipt.quote, at: p.sourceMessageAt ?? p.receipt.at, quote: p.receipt.quote, sender: p.receipt.source === 'capture' ? 'Your note' : p.clientName ?? null } : {}}
            emptyText="No source quote was saved for this fact"
          />}
          onYes={() => void confirm(p.id)}
          onNo={() => void reject(p.id)}
        />
      ),
    })),
    ...dateCards.map((p) => {
      const copy = dateCopy(p);
      const label = shortDay(p.suggestedDate);
      return {
        key: `date:${p.id}`,
        at: p.createdAt ?? 0,
        node: (
          <DateCard
            key={`date:${p.id}`}
            question={copy.question}
            said={copy.said}
            suggested={p.suggestedDate && label ? { iso: p.suggestedDate, label } : null}
            source={<ReceiptThread
              refInfo={p.receipt?.quote ? { noteId: p.noteId ?? null, clientId: p.clientId, span: p.sourceSpan ?? p.receipt.quote, at: p.sourceMessageAt ?? p.receipt.at, quote: p.receipt.quote, sender: p.owner === 'client' ? p.clientName ?? null : null } : {}}
              emptyText="No source quote was saved for this fact"
            />}
            onAnswer={(a) => void answerDate(p, a)}
          />
        ),
      };
    }),
    ...statusCards.map((c) => ({
      key: `status:${c.clientId}`,
      at: 0,
      node: (
        <AnswerCard
          key={`status:${c.clientId}`}
          label="Status suggestion"
          testId="status-suggestion"
          copy={statusCopy(c.reason, c.clientName, c.status)}
          onYes={() => void answerStatus(c, true)}
          onNo={() => void answerStatus(c, false)}
        />
      ),
    })),
  ].sort((a, b) => b.at - a.at);
  const shown = limit !== undefined ? entries.slice(0, limit) : entries;

  const body = (
    <>
      {undoKept && (
        <Toast data-testid="kept-undo" action={<Button variant="text" size="sm" onClick={() => void undoMarkKept()}>Undo</Button>}>Marked done.</Toast>
      )}
      {shown.map((e) => e.node)}
    </>
  );
  // [P39-5] On Today: section 3, "Needs your answer" — at most `limit`, then "See all N".
  if (limit !== undefined) {
    return (
      <Section title="Needs your answer" explanation="Tovira isn't sure about these. Your answer decides." testId="needs-answer">
        <div className="tov-confirm-queue ui-stack ui-gap-3">{body}</div>
        {total > limit && <div><Button variant="text" onClick={onSeeAll}>See all {total}</Button></div>}
      </Section>
    );
  }
  // [P39-6] The full screen: PageHeader "← Today", "Needs your answer", the count as its subtitle.
  if (standalone) {
    return (
      <Page testId="confirm-page" label="Needs your answer">
        {header}
        <div className="tov-confirm-queue ui-stack ui-gap-3">{body}</div>
      </Page>
    );
  }
  return (
    <Section title={heading} testId="confirm-queue">
      <div className="tov-confirm-queue ui-stack ui-gap-3">{body}</div>
    </Section>
  );
}
