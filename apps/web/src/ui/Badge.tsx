import type { ReactNode } from 'react';

/** [P39] A small pill: a status or a count. tone carries meaning (danger = overdue / act). */
export function Badge({ children, tone, ...rest }: { children: ReactNode; tone?: 'danger' | 'warning' | 'success' | 'accent' } & Record<string, unknown>): JSX.Element {
  return <span className={`ui-badge${tone ? ` ui-badge--${tone}` : ''}`} {...rest}>{children}</span>;
}
