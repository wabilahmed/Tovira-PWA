import { UpsellBanner, type Upsell } from './ImportReview.js';
import type { Plan } from '../billing/plans.js';

/**
 * [BULK-IMPORT · RULING 2] The batch progress / result view. One row per chat with its state, and —
 * when chats failed because the account hit its monthly usage limit — the exact ruling copy plus the
 * pack (or Subscribe, for a trial) prompt and the invitation to re-upload. A usage-limited chat was
 * never stored (its content is discarded), so re-uploading is how the rep retries after adding messages. [P83] A chat
 * that was stored but had more messages to read than were left waits instead, and is read once messages are added.
 */
export type BulkJobState = 'queued' | 'extracting' | 'done' | 'failed' | 'failed_usage_limit' | 'failed_interrupted' | 'waiting_messages';
export interface BulkJob {
  key: string;
  state: BulkJobState;
}

const ROW_COPY: Record<BulkJobState, string> = {
  queued: 'Waiting…',
  extracting: 'Analysing…',
  done: 'Imported.',
  failed: "Couldn't read this chat. Your messages weren't used.", // [P84-6 · owner] its messages are given back
  failed_usage_limit: 'Not imported. No messages were left this month.', // [P83] messages, never usage
  waiting_messages: 'Saved. Tovira reads it as soon as you add messages.', // [P83] stored, read after a pack or the reset
  failed_interrupted: 'Not imported. Something went wrong. Please re-upload this chat.',
};

/** [P20-3 / BULK-08] The one batch summary — shown here and in the single aggregate notification. */
export interface BulkSummary { chatsImported: number; promises: number; requirements: number }

/** [P20-3] "Imported N chats — found X promises, Y requirements." (same wording as the notification). */
export function bulkSummaryLine(s: BulkSummary): string {
  const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`;
  return `Imported ${plural(s.chatsImported, 'chat')}. Found ${plural(s.promises, 'promise')}, ${plural(s.requirements, 'requirement')}.`;
}

/** [P65-4 · owner] "3 of 8 chats done": finished chats (imported or not) of all of them. */
export function bulkProgressLine(jobs: BulkJob[]): string {
  const finished = jobs.filter((j) => j.state !== 'queued' && j.state !== 'extracting').length;
  return `${finished} of ${jobs.length} chat${jobs.length === 1 ? '' : 's'} done`;
}

export function BulkImportResult({ jobs, upsell, onOpenSubscription, onSubscribe, summary, onOpenBookScan }: {
  jobs: BulkJob[];
  upsell?: Upsell;
  /** [P37] open Settings → Subscription (the one home of the top-up picker). */
  onOpenSubscription?: () => void;
  onSubscribe?: (plan: Plan) => void;
  /** [P20-3 / BULK-08] present once the batch is done — drives the summary + Open Book Scan button. */
  summary?: BulkSummary;
  onOpenBookScan?: () => void;
}): JSX.Element {
  const limited = jobs.filter((j) => j.state === 'failed_usage_limit').length;
  const waiting = jobs.filter((j) => j.state === 'waiting_messages').length;

  return (
    <section aria-label="Import results" data-testid="bulk-import-result" style={{ display: 'grid', gap: 'var(--space-3)' }}>
      {summary && summary.chatsImported > 0 && (
        <div data-testid="bulk-summary" style={{ display: 'grid', gap: 'var(--space-2)' }}>
          <p style={{ margin: 0 }}>{bulkSummaryLine(summary)}</p>
          {onOpenBookScan && <button type="button" className="tov-primary" onClick={onOpenBookScan}>Open Book Scan</button>}
        </div>
      )}
      {jobs.some((j) => j.state === 'queued' || j.state === 'extracting') && (
        <p data-testid="bulk-progress" role="status" style={{ margin: 0 }}>{bulkProgressLine(jobs)}</p>
      )}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--space-2)' }}>
        {jobs.map((j) => (
          <li key={j.key} data-testid={`result-row-${j.key}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
            <span>{j.key}</span>
            <span style={{ color: j.state === 'done' ? 'var(--text-secondary)' : 'var(--claret)' }}>{ROW_COPY[j.state]}</span>
          </li>
        ))}
      </ul>

      {(limited > 0 || waiting > 0) && (
        <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
          {waiting > 0 && (
            <p style={{ margin: 0 }} data-testid="bulk-waiting">
              {waiting} {waiting === 1 ? 'chat is' : 'chats are'} saved and waiting: more messages to read than you have left this month.
            </p>
          )}
          {limited > 0 && (
            <p style={{ margin: 0 }}>
              {limited} {limited === 1 ? 'chat' : 'chats'} weren&rsquo;t imported because no messages were left this month.
            </p>
          )}
          {upsell && (
            <UpsellBanner upsell={upsell} lead={limited > 0 ? 'Add messages, then re-upload the ones not imported.' : 'Add messages and Tovira reads them straight away.'} onOpenSubscription={onOpenSubscription} onSubscribe={onSubscribe} />
          )}
        </div>
      )}
    </section>
  );
}
