import { UpsellBanner, type Upsell } from './ImportReview.js';
import type { Plan } from '../billing/plans.js';

/**
 * [BULK-IMPORT · RULING 2] The batch progress / result view. One row per chat with its state, and —
 * when chats failed because the account hit its monthly usage limit — the exact ruling copy plus the
 * top-up (or Subscribe, for a trial) prompt and the invitation to re-upload. A usage-limited chat was
 * never stored (its content is discarded), so re-uploading is how the rep retries after topping up.
 */
export type BulkJobState = 'queued' | 'extracting' | 'done' | 'failed' | 'failed_usage_limit' | 'failed_interrupted';
export interface BulkJob {
  key: string;
  state: BulkJobState;
}

const ROW_COPY: Record<BulkJobState, string> = {
  queued: 'Waiting…',
  extracting: 'Analysing…',
  done: 'Imported.',
  failed: "Couldn't be read — not imported.",
  failed_usage_limit: 'Not imported. You reached your monthly usage limit.',
  failed_interrupted: 'Not imported. Something went wrong. Please re-upload this chat.',
};

/** [P20-3 / BULK-08] The one batch summary — shown here and in the single aggregate notification. */
export interface BulkSummary { chatsImported: number; promises: number; requirements: number }

/** [P20-3] "Imported N chats — found X promises, Y requirements." (same wording as the notification). */
export function bulkSummaryLine(s: BulkSummary): string {
  const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`;
  return `Imported ${plural(s.chatsImported, 'chat')} — found ${plural(s.promises, 'promise')}, ${plural(s.requirements, 'requirement')}.`;
}

export function BulkImportResult({ jobs, upsell, onTopUp, onSubscribe, summary, onOpenBookScan }: {
  jobs: BulkJob[];
  upsell?: Upsell;
  onTopUp?: (optionId: string) => void;
  onSubscribe?: (plan: Plan) => void;
  /** [P20-3 / BULK-08] present once the batch is done — drives the summary + Open Book Scan button. */
  summary?: BulkSummary;
  onOpenBookScan?: () => void;
}): JSX.Element {
  const limited = jobs.filter((j) => j.state === 'failed_usage_limit').length;

  return (
    <section aria-label="Import results" data-testid="bulk-import-result" style={{ display: 'grid', gap: '0.75rem' }}>
      {summary && summary.chatsImported > 0 && (
        <div data-testid="bulk-summary" style={{ display: 'grid', gap: '0.5rem' }}>
          <p style={{ margin: 0 }}>{bulkSummaryLine(summary)}</p>
          {onOpenBookScan && <button type="button" className="tov-primary" onClick={onOpenBookScan}>Open Book Scan</button>}
        </div>
      )}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '0.5rem' }}>
        {jobs.map((j) => (
          <li key={j.key} data-testid={`result-row-${j.key}`} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
            <span>{j.key}</span>
            <span style={{ color: j.state === 'done' ? 'var(--text-secondary)' : 'var(--claret, #a23)' }}>{ROW_COPY[j.state]}</span>
          </li>
        ))}
      </ul>

      {limited > 0 && (
        <div style={{ display: 'grid', gap: '0.5rem' }}>
          <p style={{ margin: 0 }}>
            {limited} {limited === 1 ? 'chat' : 'chats'} weren&rsquo;t imported because you reached your monthly usage limit.
          </p>
          {upsell && (
            <UpsellBanner upsell={upsell} lead="Re-upload them after topping up." onTopUp={onTopUp} onSubscribe={onSubscribe} />
          )}
        </div>
      )}
    </section>
  );
}
