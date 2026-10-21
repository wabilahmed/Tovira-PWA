import type { ReactNode } from 'react';

/** [P39] A row of filter chips: scrolls horizontally, no visible scrollbar, a fade at the edge — never clipped. */
export function ChipGroup({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div className="ui-chipgroup" role="group" aria-label={label}>
      <div className="ui-chipgroup__track">{children}</div>
    </div>
  );
}

export function Chip({ selected = false, count, onClick, children, ...rest }: { selected?: boolean; count?: number; onClick: () => void; children: ReactNode } & Record<string, unknown>): JSX.Element {
  return (
    <button type="button" className="ui-chip" aria-pressed={selected} onClick={onClick} {...rest}>
      {children}
      {count !== undefined && <span className="ui-chip__count">{count}</span>}
    </button>
  );
}
