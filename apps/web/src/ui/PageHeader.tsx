import type { ReactNode } from 'react';
import { Button } from './Button.js';

/**
 * [P39] Every screen's header: an optional "← Back" (to where the rep came from), the title, an optional
 * subtitle, and an optional primary action. Rendered inside <Page>.
 */
export function PageHeader({ title, subtitle, back, action, titleId }: {
  title: ReactNode;
  subtitle?: ReactNode;
  /** The back control: its label ("Clients", "Today", "Find") and what it does. */
  back?: { label: string; onBack: () => void };
  action?: ReactNode;
  titleId?: string;
}): JSX.Element {
  return (
    <header className="ui-header" data-testid="page-header">
      {back && (
        <div className="ui-header__back">
          <Button variant="text" size="sm" onClick={back.onBack} aria-label={`Back to ${back.label}`}>← {back.label}</Button>
        </div>
      )}
      <div className="ui-header__titles">
        <h1 className="ui-title" id={titleId} dir="auto">{title}</h1>
        {subtitle && <p className="ui-subtitle">{subtitle}</p>}
      </div>
      {action && <div className="ui-header__action">{action}</div>}
    </header>
  );
}

/** [P39] The page template: gutters, the section rhythm (32 between sections), a max width. */
export function Page({ children, testId, label }: { children: ReactNode; testId?: string; label?: string }): JSX.Element {
  return <div className="ui-page" data-testid={testId ?? 'page'} data-page-template="" aria-label={label}>{children}</div>;
}
