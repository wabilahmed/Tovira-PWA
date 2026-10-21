import type { ButtonHTMLAttributes, ReactNode } from 'react';

/** [P39] The one button: primary / secondary / text, sm / md, with loading and disabled states. */
export function Button({ variant = 'secondary', size = 'md', loading = false, block = false, danger = false, children, className = '', disabled, ...rest }: {
  variant?: 'primary' | 'secondary' | 'text';
  size?: 'sm' | 'md';
  loading?: boolean;
  block?: boolean;
  danger?: boolean;
  children: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>): JSX.Element {
  const cls = ['ui-btn', `ui-btn--${variant}`, size === 'sm' ? 'ui-btn--sm' : '', block ? 'ui-btn--block' : '', danger ? 'ui-btn--danger' : '', className].filter(Boolean).join(' ');
  return (
    <button type="button" className={cls} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading && <span className="ui-btn__spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}

/** A square 44px icon button; the label is its accessible name. */
export function IconButton({ label, children, className = '', ...rest }: { label: string; children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>): JSX.Element {
  return <button type="button" className={`ui-iconbtn ${className}`.trim()} aria-label={label} title={label} {...rest}>{children}</button>;
}

/** Card actions: their own row, 12px below the content above, nothing overlapping. */
export function ActionRow({ children }: { children: ReactNode }): JSX.Element {
  return <div className="ui-actions">{children}</div>;
}
