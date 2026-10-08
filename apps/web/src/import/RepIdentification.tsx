/**
 * [AUDIT item 3] A single radio group for resolving who a two-speaker chat is — reused by BOTH import
 * paths. Bulk import asks "Which of these is you?" (pick the rep); single import asks "Which one is
 * <client>?" (pick the client). The component is just the labelled radio group; each caller supplies the
 * legend and interprets the choice.
 */
export function RepIdentification({ legend, candidates, value, onChange }: {
  legend: string;
  candidates: string[];
  value: string | null;
  onChange: (choice: string) => void;
}): JSX.Element {
  return (
    <fieldset data-testid="rep-id" style={{ border: '1px solid var(--hairline)', borderRadius: '0.5rem', padding: '0.75rem' }}>
      <legend>{legend}</legend>
      {candidates.map((p) => (
        <label key={p} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <input type="radio" name="rep-id" checked={value === p} onChange={() => onChange(p)} />
          <span>{p}</span>
        </label>
      ))}
    </fieldset>
  );
}
