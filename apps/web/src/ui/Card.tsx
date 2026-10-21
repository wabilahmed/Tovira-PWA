import type { ReactNode } from 'react';

/** [P39] A card: 16 padding, 16 between its blocks. tone 'warning' for a question to answer. */
export function Card({ children, tone, className = '', ...rest }: { children: ReactNode; tone?: 'warning' | 'danger'; className?: string } & Record<string, unknown>): JSX.Element {
  return <div className={['ui-card', tone ? `ui-card--${tone}` : '', className].filter(Boolean).join(' ')} {...rest}>{children}</div>;
}
