import type { ReactNode } from 'react';

/** [P39] A list row: title (2 lines max), one secondary line, one meta line, a trailing action. Tappable. */
export function ListRow({ title, secondary, meta, trailing, onOpen, openLabel, testId }: {
  title: ReactNode;
  secondary?: ReactNode;
  meta?: ReactNode;
  trailing?: ReactNode;
  onOpen?: () => void;
  /** The tap target's accessible name (e.g. "Open Sara Khan"). */
  openLabel?: string;
  testId?: string;
}): JSX.Element {
  const body = (
    <>
      <span className="ui-row__title" dir="auto" data-testid="row-name">{title}</span>
      {secondary && <span className="ui-row__secondary" dir="auto" data-testid="row-wants">{secondary}</span>}
      {meta && <span className="ui-row__meta" data-testid="row-activity">{meta}</span>}
    </>
  );
  return (
    <li className="ui-row" data-testid={testId}>
      {onOpen
        ? <button type="button" className="ui-row__main" aria-label={openLabel} onClick={onOpen}>{body}</button>
        : <div className="ui-row__main">{body}</div>}
      {trailing && <div className="ui-row__trailing">{trailing}</div>}
    </li>
  );
}
