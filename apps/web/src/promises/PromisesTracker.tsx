import { useEffect, useState, useRef } from 'react';
import type { OpenPromise } from './promisesClient.js';
import { hapticTick } from '../haptics.js';
import { Page, PageHeader } from '../ui/PageHeader.js';
import { Badge, Button, Chip, ChipGroup, EmptyState, ListRow, Sheet, Toast } from '../ui/index.js';
import { ReceiptThread } from '../receipts/ReceiptThread.js';
import { DateCard } from '../confirm/ConfirmChit.js';
import { dateCopy, shortDay } from '../confirm/cardCopy.js';
import { aiText } from '../format/aiText.js';

type DateAnswer = { dueDate: string } | { dateStatus: 'not_sure' | 'no_due_date' };
export interface PromisesApi {
  listOpen(): Promise<OpenPromise[]>;
  listConfirmations(): Promise<OpenPromise[]>;
  markDone(id: string): Promise<boolean>;
  confirm(id: string): Promise<boolean>;
  reject(id: string): Promise<boolean>;
  editDueDate(id: string, dueDate: string | null): Promise<boolean>;
  /** [P20-2 / BOOK-09] Soft-delete + undo. */
  deletePromise(id: string): Promise<boolean>;
  restore(id: string): Promise<boolean>;
  /** [P46-6b] Open + done promises and the "older" window in one read (preferred over listOpen when present). */
  tracker?(): Promise<{ promises: OpenPromise[]; done: OpenPromise[]; staleThresholdDays: number }>;
  /** [P40-1] Answer "when is it due?" for a promise whose date is to confirm. */
  answerDate?(id: string, answer: DateAnswer): Promise<boolean>;
}

/** [P20-2 / BOOK-09] How long the "Promise deleted. Undo" toast stays before the delete is final (ms). */
const UNDO_WINDOW_MS = 10_000;
type Filter = 'open' | 'overdue' | 'confirm' | 'done' | 'older';
type Where = 'open' | 'pending' | 'done';
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * The Promises screen (P4-1 → P46-6b). Filter chips (Open · Overdue · To confirm · Done · Older than N days); each
 * promise is a card naming the client, the promise in full, whose promise it is, one status badge and its receipt.
 * Tapping a card opens its sheet: Mark done, Change date (saved once, on confirm), Answer "when is it due?" for a date
 * to confirm, and Delete last (with Undo). Nothing destructive sits on the row.
 */
export function PromisesTracker({ api, now = Date.now(), back }: { api: PromisesApi; now?: number; back?: { label: string; onBack: () => void } }): JSX.Element {
  const [open, setOpen] = useState<OpenPromise[]>([]);
  const [pending, setPending] = useState<OpenPromise[]>([]);
  const [done, setDone] = useState<OpenPromise[]>([]);
  const [olderDays, setOlderDays] = useState(90);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('open');
  const [sheet, setSheet] = useState<{ p: OpenPromise; where: Where } | null>(null);
  // [P20-2 / BOOK-09] the pending "Promise deleted. Undo" toast + its 10s window timer.
  const [undo, setUndo] = useState<{ p: OpenPromise; where: 'open' | 'pending' } | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (undoTimer.current) clearTimeout(undoTimer.current); }, []);

  useEffect(() => {
    let live = true;
    const openP = api.tracker ? api.tracker() : api.listOpen().then((promises) => ({ promises, done: [] as OpenPromise[], staleThresholdDays: 90 }));
    void Promise.all([openP, api.listConfirmations()]).then(([t, pend]) => {
      if (!live) return;
      setOpen(t.promises);
      setDone(t.done);
      setOlderDays(t.staleThresholdDays);
      setPending(pend);
      setLoading(false);
    });
    return () => { live = false; };
  }, [api]);

  const close = (): void => setSheet(null);
  async function markDone(p: OpenPromise): Promise<void> {
    setError(null);
    if (await api.markDone(p.id)) {
      hapticTick(); // promise kept
      setOpen((prev) => prev.filter((x) => x.id !== p.id));
      setDone((prev) => [{ ...p, done: true }, ...prev]);
      close();
    } else { close(); setError('Could not mark that done. Please try again.'); }
  }
  async function confirm(p: OpenPromise): Promise<void> {
    if (await api.confirm(p.id)) { hapticTick(); setPending((prev) => prev.filter((x) => x.id !== p.id)); close(); }
  }
  async function reject(p: OpenPromise): Promise<void> {
    if (await api.reject(p.id)) { setPending((prev) => prev.filter((x) => x.id !== p.id)); close(); }
  }
  // [AUDIT item 2 · P43-8] Correct a wrong due date in place (keeps the receipt), saved once on confirm; empty is ignored.
  async function editDate(p: OpenPromise, value: string): Promise<void> {
    if (!value) return;
    setError(null);
    if (await api.editDueDate(p.id, value)) {
      setOpen((prev) => prev.map((x) => (x.id === p.id ? { ...x, dueDate: value, dateStatus: null } : x)));
      close();
    } else setError('Could not update that date. Please try again.');
  }
  async function answer(p: OpenPromise, a: DateAnswer): Promise<void> {
    if (!api.answerDate || !(await api.answerDate(p.id, a))) { setError('Could not save that. Please try again.'); return; }
    setOpen((prev) => prev.map((x) => (x.id === p.id ? { ...x, ...('dueDate' in a ? { dueDate: a.dueDate } : {}), dateStatus: 'dueDate' in a ? null : a.dateStatus } : x)));
    close();
  }
  // [P20-2 / BOOK-09] Delete (soft, undoable): gone at once, "Promise deleted. Undo" for 10s; Undo restores it.
  async function del(p: OpenPromise, where: 'open' | 'pending'): Promise<void> {
    setError(null);
    close();
    if (where === 'open') setOpen((prev) => prev.filter((x) => x.id !== p.id));
    else setPending((prev) => prev.filter((x) => x.id !== p.id));
    if (!(await api.deletePromise(p.id))) {
      if (where === 'open') setOpen((prev) => [p, ...prev]); else setPending((prev) => [p, ...prev]);
      setError('Could not delete that. Please try again.');
      return;
    }
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndo({ p, where });
    undoTimer.current = setTimeout(() => setUndo(null), UNDO_WINDOW_MS);
  }
  async function undoDelete(): Promise<void> {
    if (!undo) return;
    if (undoTimer.current) clearTimeout(undoTimer.current);
    const { p, where } = undo;
    setUndo(null);
    if (await api.restore(p.id)) {
      if (where === 'open') setOpen((prev) => [p, ...prev].sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999')));
      else setPending((prev) => [p, ...prev]);
    } else setError('Could not undo. Please reload.');
  }

  const header = <PageHeader title="Promises" {...(back ? { back } : {})} />;
  if (loading) return <Page testId="promises-page" label="Promises">{header}<p className="ui-secondary">Loading your promises…</p></Page>;

  // [PROMISE-STALE] Active = not stale; stale (overdue past the window) sits behind "Older than N days".
  const active = open.filter((p) => !p.stale);
  const stale = open.filter((p) => p.stale);
  const overdueList = active.filter((p) => overdue(p, now));
  const toConfirm: Array<{ p: OpenPromise; where: Where }> = [...pending.map((p) => ({ p, where: 'pending' as const })), ...active.filter((p) => p.dateStatus === 'to_confirm').map((p) => ({ p, where: 'open' as const }))];
  const list: Array<{ p: OpenPromise; where: Where }> =
    filter === 'open' ? active.map((p) => ({ p, where: 'open' }))
      : filter === 'overdue' ? overdueList.map((p) => ({ p, where: 'open' }))
        : filter === 'confirm' ? toConfirm
          : filter === 'done' ? done.map((p) => ({ p, where: 'done' }))
            : stale.map((p) => ({ p, where: 'open' }));
  const testId = (where: Where, p: OpenPromise): string => (where === 'pending' ? 'pending-promise' : where === 'done' ? 'done-promise' : p.stale ? 'stale-promise' : 'open-promise');

  return (
    <Page testId="promises-page" label="Promises">
      {header}
      <ChipGroup label="Filter promises">
        <Chip selected={filter === 'open'} count={active.length} onClick={() => setFilter('open')}>Open</Chip>
        <Chip selected={filter === 'overdue'} count={overdueList.length} onClick={() => setFilter('overdue')}>Overdue</Chip>
        <Chip selected={filter === 'confirm'} count={toConfirm.length} onClick={() => setFilter('confirm')}>To confirm</Chip>
        <Chip selected={filter === 'done'} count={done.length} onClick={() => setFilter('done')}>Done</Chip>
        {stale.length > 0 && <Chip selected={filter === 'older'} onClick={() => setFilter('older')}>Older than {olderDays} days ({stale.length})</Chip>}
      </ChipGroup>
      {error && <p role="alert" className="ui-danger">{error}</p>}
      {active.length === 0 && stale.length === 0 && filter === 'open' ? (
        <EmptyState title="No open promises. You're all caught up." />
      ) : list.length === 0 ? (
        <p className="ui-secondary">Nothing here.</p>
      ) : (
        <ul className="ui-list ui-list--cards">
          {list.map(({ p, where }) => (
            <ListRow
              key={`${where}:${p.id}`}
              testId={testId(where, p)}
              title={p.clientName ?? 'No client'}
              secondary={aiText(p.text)}
              meta={<span className="ui-cluster ui-gap-2" style={{ flexWrap: 'wrap' }}><span>{whose(p)}</span>{where === 'done' ? <Badge tone="success">Done</Badge> : <StatusBadge p={p} now={now} />}</span>}
              below={p.receipt?.quote ? <div data-testid="row-receipt"><ReceiptThread compact refInfo={{ noteId: p.noteId ?? null, clientId: p.clientId, span: p.sourceSpan ?? p.receipt.quote, at: p.sourceMessageAt ?? p.receipt.at, quote: p.receipt.quote }} /></div> : undefined}
              onOpen={() => setSheet({ p, where })}
              openLabel={`Open: ${p.text}`}
            />
          ))}
        </ul>
      )}
      {sheet && (
        <PromiseSheet
          p={sheet.p} where={sheet.where} onClose={close}
          onDone={() => void markDone(sheet.p)} onConfirm={() => void confirm(sheet.p)} onReject={() => void reject(sheet.p)}
          onDate={(v) => void editDate(sheet.p, v)} onAnswer={api.answerDate ? (a) => void answer(sheet.p, a) : undefined}
          onDelete={() => void del(sheet.p, sheet.where === 'pending' ? 'pending' : 'open')}
        />
      )}
      {undo && (
        <Toast data-testid="promise-undo" action={<Button size="sm" variant="text" onClick={() => void undoDelete()}>Undo</Button>}>Promise deleted.</Toast>
      )}
    </Page>
  );
}

function PromiseSheet({ p, where, onClose, onDone, onConfirm, onReject, onDate, onAnswer, onDelete }: {
  p: OpenPromise; where: Where; onClose: () => void; onDone: () => void; onConfirm: () => void; onReject: () => void;
  onDate: (v: string) => void; onAnswer?: (a: DateAnswer) => void; onDelete: () => void;
}): JSX.Element {
  const [mode, setMode] = useState<'menu' | 'date' | 'answer'>('menu');
  const copy = dateCopy(p);
  const label = shortDay(p.suggestedDate);
  return (
    <Sheet open onClose={onClose} title={p.clientName ?? 'Promise'}>
      <div className="ui-stack ui-gap-3">
        <p dir="auto" style={{ margin: 0 }}>{aiText(p.text)}</p>
        <p className="ui-secondary">{whose(p)}{p.dueDate && p.dueRaw ? ` · from “${p.dueRaw}”` : ''}</p>
        {mode === 'date' && <DueDateField label={`Due date for: ${p.text}`} stored={p.dueDate ?? ''} onConfirm={onDate} />}
        {mode === 'answer' && onAnswer && (
          <DateCard question={copy.question} said={copy.said} suggested={p.suggestedDate && label ? { iso: p.suggestedDate, label } : null} onAnswer={onAnswer} />
        )}
        {mode === 'menu' && (
          <div className="ui-stack ui-gap-2">
            {where === 'pending' && <Button variant="primary" block onClick={onConfirm}>Confirm</Button>}
            {where === 'pending' && <Button block onClick={onReject}>Reject</Button>}
            {where !== 'pending' && where !== 'done' && <Button variant="primary" block onClick={onDone}>Mark done</Button>}
            {where !== 'done' && <Button block onClick={() => setMode('date')}>Change date</Button>}
            {where !== 'done' && onAnswer && p.dateStatus === 'to_confirm' && <Button block onClick={() => setMode('answer')}>Answer “when is it due?”</Button>}
            {where !== 'done' && <Button block danger aria-label={`Delete promise: ${p.text}`} onClick={onDelete}>Delete</Button>}
          </div>
        )}
      </div>
    </Sheet>
  );
}

function whose(p: OpenPromise): string {
  return p.owner === 'client' ? `${p.clientName ?? 'The client'} promised` : 'You promised';
}

/** One status badge: Overdue, "Due Thu 29 Oct", Date to confirm “the phrase”, or No date. Normal case, never mono. */
function StatusBadge({ p, now }: { p: OpenPromise; now: number }): JSX.Element {
  if (overdue(p, now)) return <Badge tone="danger">Overdue</Badge>;
  if (p.dueDate) return <Badge>{dueLabel(p.dueDate, now)}</Badge>;
  const phrase = p.dueRaw ? ` “${p.dueRaw}”` : '';
  if (p.dateStatus === 'to_confirm') return <Badge tone="warning">Date to confirm{phrase}</Badge>;
  return <Badge>No date{phrase}</Badge>;
}

function dueLabel(iso: string, now: number): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number) as [number, number, number];
  const date = new Date(y, m - 1, d);
  return `Due ${DAYS[date.getDay()]} ${d} ${MONTHS[m - 1]}${y === new Date(now).getFullYear() ? '' : ` ${y}`}`;
}

/** A promise is overdue when its resolved due date is before today. Elapsed time is a fact (§10). */
function overdue(p: OpenPromise, now: number): boolean {
  if (!p.dueDate) return false;
  const t = Date.parse(p.dueDate);
  return Number.isFinite(t) && t < now;
}

/** [P43-8 · owner] The date is saved when the rep confirms it (the picker closes / the field loses focus, or Enter),
 *  not on every picker change: adjusting it three times then confirming writes ONE edit record. Unchanged → nothing. */
function DueDateField({ label, stored, onConfirm }: { label: string; stored: string; onConfirm: (value: string) => void }): JSX.Element {
  const [draft, setDraft] = useState(stored);
  const sent = useRef<string | null>(null); // a second blur before the save lands never sends it again
  useEffect(() => { setDraft(stored); sent.current = null; }, [stored]);
  const confirm = (): void => { if (draft && draft !== stored && draft !== sent.current) { sent.current = draft; onConfirm(draft); } };
  return (
    <label className="ui-field">
      <span className="ui-field__label">Due date</span>
      <input
        type="date"
        className="ui-input ui-native-select"
        aria-label={label}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={confirm}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      />
    </label>
  );
}
