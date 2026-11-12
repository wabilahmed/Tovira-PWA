import { useState } from 'react';
import { Button } from '../ui/index.js';
import { NOUN, foundNothing, type FoundCounts, type ProcessingItem } from './processingClient.js';

/**
 * [P65 · owner] The status card at the top of a client's page: while Tovira is reading what the rep sent (the real
 * stage only, never a fake progress bar), what it found when it is done (each count opens its section), plainly when it
 * found nothing, and why when it couldn't read it (with Try again, or the way to top up). A finished card can be
 * dismissed (remembered on this device); the status itself always comes from the server.
 */
export type SectionLink = 'cares' | 'promises' | 'meetings' | 'wants' | 'people';

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
const DISMISS_KEY = 'tovira.processing.dismissed';
function readDismissed(): string[] {
  try { const v = JSON.parse(localStorage.getItem(DISMISS_KEY) ?? '[]') as unknown; return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []; } catch { return []; }
}
function writeDismissed(ids: string[]): void {
  try { localStorage.setItem(DISMISS_KEY, JSON.stringify(ids.slice(-50))); } catch { /* a private window: dismissed for this visit only */ }
}

export function minutesLine(eta: number | undefined): string {
  return !eta || eta <= 1 ? 'Usually about a minute.' : `Usually about ${eta} minutes.`;
}
export function stageLine(i: ProcessingItem): string {
  if (i.stage === 'transcribing') return 'Transcribing';
  if (i.stage === 'reading') return i.kind === 'chat' && i.messageCount ? `Analysing ${i.messageCount.toLocaleString('en-US')} messages` : 'Analysing';
  return 'Waiting to start';
}

/** "4 promises (1 overdue)", "2 dates", "3 requirements", "2 people": only what was found, each with its section. */
export function foundParts(f: FoundCounts, clientName = 'they'): Array<{ text: string; section: SectionLink }> {
  const out: Array<{ text: string; section: SectionLink }> = [];
  // [P69 · owner] what the client cares about leads ("3 things Anjali Mehra cares about"); asks are counted in it
  const cares = f.caresAbout ?? 0;
  if (cares) out.push({ text: `${plural(cares, 'thing')} ${clientName} ${clientName === 'they' ? 'care' : 'cares'} about`, section: 'cares' });
  if (f.promises) out.push({ text: `${plural(f.promises, 'promise')}${f.overduePromises ? ` (${f.overduePromises} overdue)` : ''}`, section: 'promises' });
  if (f.dates) out.push({ text: plural(f.dates, 'date'), section: 'meetings' });
  if (f.requirements && f.caresAbout === undefined) out.push({ text: plural(f.requirements, 'requirement'), section: 'wants' }); // an older server
  if (f.people) out.push({ text: plural(f.people, 'person', 'people'), section: 'people' });
  return out;
}

const HOLD_REASON: Record<NonNullable<ProcessingItem['hold']>, string> = {
  allowance: 'Your monthly AI allowance is used up.',
  subscribe: 'Your trial has ended.',
  payment: 'Your last payment didn’t go through.',
};
const HOLD_SAVED: Record<NonNullable<ProcessingItem['hold']>, string> = {
  allowance: 'It’s saved. Tovira analyses it as soon as you top up.',
  subscribe: 'It’s saved. Tovira analyses it once you subscribe.',
  payment: 'It’s saved. Tovira analyses it once your payment is updated.',
};

export function ProcessingCard({ items, onOpenSection, onRetry, onTopUp, onSubscribe, onUpdatePayment }: {
  items: ProcessingItem[];
  onOpenSection: (s: SectionLink) => void;
  onRetry: (noteId: string) => Promise<boolean>;
  onTopUp?: () => void;
  onSubscribe?: () => void;
  onUpdatePayment?: () => void;
}): JSX.Element | null {
  const [dismissed, setDismissed] = useState<string[]>(readDismissed);
  const [retrying, setRetrying] = useState<string | null>(null);
  const shown = items.filter((i) => i.state === 'working' || i.state === 'held' || !dismissed.includes(i.noteId));
  if (shown.length === 0) return null;
  const dismiss = (id: string): void => { const next = [...dismissed, id]; setDismissed(next); writeDismissed(next); };
  return (
    <div className="ui-stack ui-gap-2" data-testid="processing-cards" style={{ margin: 'var(--space-3) 0' }}>
      {shown.map((i) => {
        const what = `this ${NOUN[i.kind]}`;
        const close = <Button variant="text" size="sm" onClick={() => dismiss(i.noteId)}>Dismiss</Button>;
        if (i.state === 'working') {
          return (
            <div key={i.noteId} className="ui-banner" role="status" data-testid={`processing-${i.noteId}`} data-state="working">
              <div>
                <p className="ui-strong" style={{ margin: 0 }}>{`Tovira is analysing ${what}.`}</p>
                <p style={{ margin: 0 }}>{`${minutesLine(i.etaMinutes)} You can leave this page.`}</p>
                <p className="ui-secondary" style={{ margin: 0 }} data-testid="processing-stage">{stageLine(i)}</p>
              </div>
            </div>
          );
        }
        if (i.state === 'held') {
          const action = i.hold === 'allowance' ? (onTopUp && <Button size="sm" onClick={onTopUp}>Buy more usage</Button>)
            : i.hold === 'subscribe' ? (onSubscribe && <Button size="sm" onClick={onSubscribe}>Subscribe</Button>)
            : (onUpdatePayment && <Button size="sm" onClick={onUpdatePayment}>Update payment</Button>);
          return (
            <div key={i.noteId} className="ui-banner ui-banner--warning" role="status" data-testid={`processing-${i.noteId}`} data-state="held">
              <div>
                <p className="ui-strong" style={{ margin: 0 }}>{`Tovira couldn't analyse ${what}.`}</p>
                <p style={{ margin: 0 }}>{HOLD_REASON[i.hold ?? 'allowance']}</p>
                <p className="ui-secondary" style={{ margin: 0 }}>{HOLD_SAVED[i.hold ?? 'allowance']}</p>
              </div>
              {action && <div className="ui-cluster ui-gap-3">{action}</div>}
            </div>
          );
        }
        if (i.state === 'failed') {
          const missing = i.failure?.reason === 'recording_missing';
          return (
            <div key={i.noteId} className="ui-banner ui-banner--danger" role="alert" data-testid={`processing-${i.noteId}`} data-state="failed">
              <div>
                <p className="ui-strong" style={{ margin: 0 }}>{`Tovira couldn't analyse ${what}.`}</p>
                <p style={{ margin: 0 }}>{missing ? 'The recording was not found, so it couldn’t be transcribed.' : 'Something went wrong on our side.'}</p>
              </div>
              <div className="ui-cluster ui-gap-3">
                {i.failure?.canRetry && (
                  <Button size="sm" loading={retrying === i.noteId} onClick={() => { setRetrying(i.noteId); void onRetry(i.noteId).finally(() => setRetrying(null)); }}>Try again</Button>
                )}
                {close}
              </div>
            </div>
          );
        }
        const f = i.found!;
        if (foundNothing(f)) {
          return (
            <div key={i.noteId} className="ui-banner" role="status" data-testid={`processing-${i.noteId}`} data-state="nothing">
              <div>
                <p className="ui-strong" style={{ margin: 0 }}>{`Done. Tovira didn't find any promises or dates in ${what}.`}</p>
                {i.kind === 'chat' && <p className="ui-secondary" style={{ margin: 0 }}>Try a chat where you discussed next steps.</p>}
              </div>
              <div className="ui-cluster ui-gap-3">{close}</div>
            </div>
          );
        }
        const parts = foundParts(f, i.clientName);
        return (
          <div key={i.noteId} className="ui-banner ui-banner--success" role="status" data-testid={`processing-${i.noteId}`} data-state="done">
            <div>
              <p style={{ margin: 0 }}>
                <span className="ui-strong">{f.caresAbout ? 'Done. ' : `Done. From ${what} Tovira found: `}</span>
                {parts.map((p, n) => (
                  <span key={p.section}>
                    <button type="button" className="tov-link" onClick={() => onOpenSection(p.section)}>{p.text}</button>
                    {n < parts.length - 1 ? ', ' : '.'}
                  </span>
                ))}
              </p>
              {f.needsAnswer > 0 && (
                <p style={{ margin: 0 }}>
                  <button type="button" className="tov-link ui-strong" onClick={() => onOpenSection('promises')}>{`${plural(f.needsAnswer, 'thing needs', 'things need')} your answer.`}</button>
                </p>
              )}
            </div>
            <div className="ui-cluster ui-gap-3">{close}</div>
          </div>
        );
      })}
    </div>
  );
}
