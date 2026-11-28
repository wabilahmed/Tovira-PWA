import type { ReactNode } from 'react';
import { Button } from './Button.js';

/** [P39] An inline banner: a message and its action(s). */
export function Banner({ tone, children, actions, ...rest }: { tone?: 'warning' | 'danger' | 'success'; children: ReactNode; actions?: ReactNode } & Record<string, unknown>): JSX.Element {
  return (
    <div className={`ui-banner${tone ? ` ui-banner--${tone}` : ''}`} role={tone === 'danger' ? 'alert' : 'status'} {...rest}>
      <div>{children}</div>
      {actions && <div className="ui-cluster ui-gap-3">{actions}</div>}
    </div>
  );
}

/** [P90-1 · owner, Prompt 88] A list that failed to load: say so and offer "Try again". Never the empty state. */
export function LoadError({ what, onRetry, ...rest }: { what: string; onRetry: () => void } & Record<string, unknown>): JSX.Element {
  return (
    <div className="ui-empty" role="alert" data-testid="load-error" {...rest}>
      <p className="ui-body ui-strong">{`Couldn't load ${what}.`}</p>
      <p className="ui-secondary">Check your connection and try again.</p>
      <Button onClick={onRetry}>Try again</Button>
    </div>
  );
}

/** [P39] A transient message with an optional action (Undo). */
export function Toast({ children, action, ...rest }: { children: ReactNode; action?: ReactNode } & Record<string, unknown>): JSX.Element {
  return <div className="ui-toast" role="status" {...rest}><span>{children}</span>{action}</div>;
}

/** [P39] An empty state: what's missing, in one line, and the way forward. */
export function EmptyState({ title, children, action, ...rest }: { title: string; children?: ReactNode; action?: ReactNode } & Record<string, unknown>): JSX.Element {
  return (
    <div className="ui-empty" {...rest}>
      <p className="ui-body ui-strong">{title}</p>
      {children && <p className="ui-secondary">{children}</p>}
      {action}
    </div>
  );
}
