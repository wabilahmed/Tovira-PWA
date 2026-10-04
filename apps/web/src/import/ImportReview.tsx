import { useMemo, useState } from 'react';

/**
 * [BULK-IMPORT · Task 3] The ONE review screen a rep sees after uploading up to 20 chat exports.
 * The parse already happened locally and deterministically on the server (parseBatch) — nothing has
 * reached a model yet (D2). This screen presents one row PER FILE, lets the rep resolve only the rows
 * that genuinely need a human call, and emits the confirmed decisions. Extraction (Task 4) starts only
 * when the rep presses Import.
 *
 * Trust rules made visible:
 *  - D3 never merge silently: a name/phone match to an existing client is a "Same person?" question,
 *    default neither — the rep must answer before Import unlocks. A "No" imports as a NEW client.
 *  - D5 unsaved numbers: an in-chat self-introduction is a SUGGESTION the rep confirms or edits, never
 *    applied on its own; with no intro the rep names them or keeps the number.
 *  - D4 group chats are skipped by default; the rep may opt in by naming the client participant.
 *  - Duplicates and unreadable files are shown (so nothing silently vanishes) but never imported.
 * Mobile-first: a flat list, one control cluster per row, so ten rows fit a single 375px scroll.
 */

export type ReviewRowState =
  | 'new'
  | 'existing'
  | 'possible_match'
  | 'unsaved_intro'
  | 'unsaved_no_intro'
  | 'group'
  | 'duplicate'
  | 'unparseable'
  | 'needs_rep_id';

export interface ReviewRow {
  fileName: string;
  platform: 'ios' | 'android' | null;
  state: ReviewRowState;
  counterpart: string | null;
  suggestedName?: string;
  matchClientId?: string;
  matchClientName?: string;
  matchKind?: 'phone' | 'name';
  /** [existing] messages that are new vs what's already stored (0 → already up to date). */
  newMessageCount?: number;
  duplicateOfFileName?: string;
  participants?: string[];
}

export interface ReviewResult {
  rows: ReviewRow[];
  repName: string | null;
  needsRepId: boolean;
}

/** [RULING 2] The top-up / subscribe upsell for a batch that would exceed the allowance. Carries only
 *  percentage labels + prices (and which option to highlight) — never an AED usage value. */
export interface TopUpChoice {
  id: string;
  label: string;
  priceAed: number;
}
export interface Upsell {
  shortfall: boolean;
  n: number;
  canTopUp: boolean;
  options: TopUpChoice[];
  recommendedOptionId: string | null;
}

/** One confirmed instruction per IMPORTED chat. A merge targets an existing client; a new chat carries
 *  the name the rep settled on (the chat name, a confirmed suggestion, or the bare number). */
export type ReviewDecision =
  | { fileName: string; action: 'new'; name: string }
  | { fileName: string; action: 'merge'; clientId: string };

interface Choice {
  /** possible_match: the rep's answer to "Same person?" */
  answer?: 'yes' | 'no';
  /** the name the rep settled on (new rename, confirmed intro, typed unsaved name, picked group member). */
  name?: string;
}

/** Does this row require a human choice before Import can proceed? */
function needsChoice(row: ReviewRow, choice: Choice | undefined): boolean {
  if (row.state === 'possible_match') return choice?.answer === undefined;
  if (row.state === 'unsaved_intro') return !(choice?.name && choice.name.trim());
  return false; // new / unsaved_no_intro / group / duplicate / unparseable all have a safe default
}

/** The confirmed decision for a row, or null when the row is not imported. */
function decide(row: ReviewRow, choice: Choice | undefined, repName: string | null): ReviewDecision | null {
  const typed = choice?.name?.trim();
  switch (row.state) {
    case 'new':
      return { fileName: row.fileName, action: 'new', name: typed || (row.counterpart ?? row.fileName) };
    case 'existing':
      // Auto-attach to the existing client — unless there is nothing new to add (already up to date).
      if (row.newMessageCount === 0 || !row.matchClientId) return null;
      return { fileName: row.fileName, action: 'merge', clientId: row.matchClientId };
    case 'possible_match':
      if (choice?.answer === 'yes' && row.matchClientId) return { fileName: row.fileName, action: 'merge', clientId: row.matchClientId };
      return { fileName: row.fileName, action: 'new', name: row.counterpart ?? row.fileName };
    case 'unsaved_intro':
      return typed ? { fileName: row.fileName, action: 'new', name: typed } : null;
    case 'unsaved_no_intro':
      return { fileName: row.fileName, action: 'new', name: typed || (row.counterpart ?? row.fileName) };
    case 'needs_rep_id': {
      // The rep picked themselves; the counterpart is the OTHER participant.
      const other = (row.participants ?? []).find((p) => p !== repName) ?? row.counterpart;
      return other ? { fileName: row.fileName, action: 'new', name: other } : null;
    }
    case 'group':
      // Skipped by default (D4); imported only if the rep named the client participant.
      return typed ? { fileName: row.fileName, action: 'new', name: typed } : null;
    case 'duplicate':
    case 'unparseable':
      return null; // shown, never imported
  }
}

export function ImportReview({ result, onImport, upsell, onTopUp, onSubscribe }: {
  result: ReviewResult;
  onImport: (decisions: ReviewDecision[]) => void;
  /** [RULING 2] when the batch would exceed the allowance, the top-up / subscribe prompt. */
  upsell?: Upsell;
  onTopUp?: (optionId: string) => void;
  onSubscribe?: () => void;
}): JSX.Element {
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [repChoice, setRepChoice] = useState<string | null>(result.repName);

  const setChoice = (fileName: string, patch: Choice): void =>
    setChoices((c) => ({ ...c, [fileName]: { ...c[fileName], ...patch } }));

  // The union of senders across the ambiguous files, so the rep can say which one is them (asked once).
  const repCandidates = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const r of result.rows) {
      if (r.state !== 'needs_rep_id') continue;
      for (const p of r.participants ?? []) if (!seen.has(p)) { seen.add(p); out.push(p); }
    }
    return out;
  }, [result.rows]);

  const repResolved = !result.needsRepId || repChoice !== null;
  const pending = result.rows.filter((r) => needsChoice(r, choices[r.fileName]));
  const canImport = repResolved && pending.length === 0;

  const disabledReason = !repResolved
    ? 'Tell us which sender is you, then you can import.'
    : pending.length > 0
      ? `${pending.length} ${pending.length === 1 ? 'chat needs' : 'chats need'} your answer before you can import.`
      : '';

  function submit(): void {
    if (!canImport) return;
    const decisions = result.rows
      .map((r) => decide(r, choices[r.fileName], repChoice))
      .filter((d): d is ReviewDecision => d !== null);
    onImport(decisions);
  }

  return (
    <section aria-label="Review chats to import" data-testid="import-review" style={{ display: 'grid', gap: '0.75rem' }}>
      <header className="tov-screenhead">
        <div className="tov-stamp">Before anything is analysed</div>
        <h2>Confirm who each chat is</h2>
      </header>

      {result.needsRepId && repCandidates.length > 0 && (
        <fieldset data-testid="rep-id" style={{ border: '1px solid var(--border, #ccc)', borderRadius: '0.5rem', padding: '0.75rem' }}>
          <legend>Which of these is you?</legend>
          {repCandidates.map((p) => (
            <label key={p} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <input
                type="radio"
                name="rep-id"
                checked={repChoice === p}
                onChange={() => setRepChoice(p)}
              />
              <span>{p}</span>
            </label>
          ))}
        </fieldset>
      )}

      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '0.75rem' }}>
        {result.rows.map((r) => (
          <li key={r.fileName} data-testid={`review-row-${r.fileName}`} style={{ border: '1px solid var(--border, #ddd)', borderRadius: '0.5rem', padding: '0.75rem' }}>
            <Row row={r} choice={choices[r.fileName]} onChoice={(patch) => setChoice(r.fileName, patch)} repResolved={repResolved} repChoice={repChoice} />
          </li>
        ))}
      </ul>

      {upsell?.shortfall && (
        <UpsellBanner
          upsell={upsell}
          lead={`This batch needs more usage than you have left this month. Top up now to import all ${upsell.n}.`}
          onTopUp={onTopUp}
          onSubscribe={onSubscribe}
        />
      )}

      {!canImport && (
        <p role="status" data-testid="import-disabled-reason" style={{ margin: 0, color: 'var(--text-secondary)' }}>
          {disabledReason}
        </p>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={!canImport}
        aria-describedby={canImport ? undefined : 'import-disabled-reason'}
      >
        Import
      </button>
    </section>
  );
}

/** [RULING 2] The top-up (or Subscribe, for a trial) prompt. Prices + percentages only — never a usage
 *  value. The recommended option (smallest covering the shortfall) is highlighted. */
export function UpsellBanner({ upsell, lead, onTopUp, onSubscribe }: {
  upsell: Upsell;
  lead: string;
  onTopUp?: (optionId: string) => void;
  onSubscribe?: () => void;
}): JSX.Element {
  return (
    <div role="status" data-testid="bulk-upsell" style={{ border: '1px solid var(--border, #ddd)', borderRadius: '0.5rem', padding: '0.75rem', display: 'grid', gap: '0.5rem' }}>
      <p style={{ margin: 0 }}>{lead}</p>
      {upsell.canTopUp ? (
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {upsell.options.map((o) => {
            const recommended = o.id === upsell.recommendedOptionId;
            return (
              <button
                key={o.id}
                type="button"
                onClick={() => onTopUp?.(o.id)}
                data-testid={recommended ? 'topup-recommended' : undefined}
                aria-label={`Top up ${o.label} for AED ${o.priceAed}`}
                className={recommended ? 'tov-primary' : undefined}
                aria-pressed={recommended}
              >
                {o.label} — AED {o.priceAed}
              </button>
            );
          })}
        </div>
      ) : (
        <button type="button" className="tov-primary" onClick={() => onSubscribe?.()}>Subscribe to keep importing</button>
      )}
    </div>
  );
}

function Row({ row, choice, onChoice, repResolved, repChoice }: {
  row: ReviewRow;
  choice: Choice | undefined;
  onChoice: (patch: Choice) => void;
  repResolved: boolean;
  repChoice: string | null;
}): JSX.Element {
  const label = row.counterpart ?? row.fileName;

  switch (row.state) {
    case 'new':
      return (
        <div>
          <strong>{label}</strong> <span style={{ color: 'var(--text-secondary)' }}>— new client</span>
          <label style={{ display: 'block', marginTop: '0.25rem' }}>
            <span style={{ fontSize: '0.85em', color: 'var(--text-secondary)' }}>Name</span>
            <input aria-label={`Name for ${row.fileName}`} value={choice?.name ?? label} onChange={(e) => onChoice({ name: e.target.value })} style={{ width: '100%' }} />
          </label>
        </div>
      );

    case 'existing':
      return (
        <div>
          <strong>✓ {row.matchClientName ?? label}</strong>{' '}
          <span style={{ color: 'var(--text-secondary)' }}>
            {row.newMessageCount === 0
              ? '— existing client. Already up to date.'
              : `— existing client, ${row.newMessageCount ?? ''} new message${row.newMessageCount === 1 ? '' : 's'}.`}
          </span>
        </div>
      );

    case 'possible_match':
      return (
        <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
          <legend><strong>{label}</strong> — matches your existing client {row.matchClientName}. Same person?</legend>
          <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <input type="radio" name={`match-${row.fileName}`} checked={choice?.answer === 'yes'} onChange={() => onChoice({ answer: 'yes' })} />
            <span>Yes, same person as {row.matchClientName}</span>
          </label>
          <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <input type="radio" name={`match-${row.fileName}`} checked={choice?.answer === 'no'} onChange={() => onChoice({ answer: 'no' })} />
            <span>No, a different client</span>
          </label>
        </fieldset>
      );

    case 'unsaved_intro':
      return (
        <div>
          <strong>{label}</strong> <span style={{ color: 'var(--text-secondary)' }}>— unsaved number. Looks like “{row.suggestedName}”. Use this name?</span>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem', flexWrap: 'wrap' }}>
            <button type="button" onClick={() => onChoice({ name: row.suggestedName })}>Use “{row.suggestedName}”</button>
          </div>
          <label style={{ display: 'block', marginTop: '0.25rem' }}>
            <span style={{ fontSize: '0.85em', color: 'var(--text-secondary)' }}>…or type a different name</span>
            <input aria-label={`Name for ${row.fileName}`} value={choice?.name ?? ''} onChange={(e) => onChoice({ name: e.target.value })} style={{ width: '100%' }} />
          </label>
        </div>
      );

    case 'unsaved_no_intro':
      return (
        <div>
          <strong>{label}</strong> <span style={{ color: 'var(--text-secondary)' }}>— unsaved number. Who is this? (optional — keep the number if you’re not sure)</span>
          <label style={{ display: 'block', marginTop: '0.25rem' }}>
            <span style={{ fontSize: '0.85em', color: 'var(--text-secondary)' }}>Name</span>
            <input aria-label={`Name for ${row.fileName}`} value={choice?.name ?? ''} placeholder={label} onChange={(e) => onChoice({ name: e.target.value })} style={{ width: '100%' }} />
          </label>
        </div>
      );

    case 'needs_rep_id': {
      const other = repResolved ? (row.participants ?? []).find((p) => p !== repChoice) : null;
      return (
        <div>
          <strong>{other ?? row.fileName}</strong>{' '}
          <span style={{ color: 'var(--text-secondary)' }}>{other ? '— new client' : '— tell us which sender is you (above)'}</span>
        </div>
      );
    }

    case 'group':
      return (
        <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
          <legend><strong>{row.fileName}</strong> — Group chat. Skipped.</legend>
          <label style={{ display: 'block', marginTop: '0.25rem' }}>
            <span style={{ fontSize: '0.85em', color: 'var(--text-secondary)' }}>Import anyway for one participant?</span>
            <select aria-label={`Client participant for ${row.fileName}`} value={choice?.name ?? ''} onChange={(e) => onChoice({ name: e.target.value })} style={{ width: '100%' }}>
              <option value="">Keep skipped</option>
              {(row.participants ?? []).map((p) => (<option key={p} value={p}>{p}</option>))}
            </select>
          </label>
        </fieldset>
      );

    case 'duplicate':
      return (
        <div style={{ color: 'var(--text-secondary)' }}>
          <strong>{row.fileName}</strong> — Same chat as {row.duplicateOfFileName}. Not imported twice.
        </div>
      );

    case 'unparseable':
      return (
        <div style={{ color: 'var(--text-secondary)' }}>
          <strong>{row.fileName}</strong> — Could not read this file. Excluded.
        </div>
      );
  }
}
