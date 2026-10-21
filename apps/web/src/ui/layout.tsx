import type { ReactNode } from 'react';

/** [P39] Layout primitives — gaps only from the spacing scale (1–6 = 4·8·12·16·24·32). */
export type Gap = 1 | 2 | 3 | 4 | 5 | 6;

export function Stack({ gap = 3, children, className = '', as: As = 'div', ...rest }: { gap?: Gap; children?: ReactNode; className?: string; as?: 'div' | 'section' | 'ul' | 'ol' | 'li' | 'form' } & Record<string, unknown>): JSX.Element {
  const Tag = As as 'div';
  return <Tag className={`ui-stack ui-gap-${gap} ${className}`.trim()} {...rest}>{children}</Tag>;
}

export function Cluster({ gap = 2, children, className = '', ...rest }: { gap?: Gap; children?: ReactNode; className?: string } & Record<string, unknown>): JSX.Element {
  return <div className={`ui-cluster ui-gap-${gap} ${className}`.trim()} {...rest}>{children}</div>;
}

/** A titled block of a page: section title, an optional one-line explanation, then its content (12–16 inside). */
export function Section({ title, explanation, action, children, id, testId }: { title?: ReactNode; explanation?: ReactNode; action?: ReactNode; children?: ReactNode; id?: string; testId?: string }): JSX.Element {
  return (
    <section className="ui-section" id={id} data-testid={testId} aria-label={typeof title === 'string' ? title : undefined}>
      {(title || explanation) && (
        <div className="ui-section__head">
          {title && <div className="ui-cluster ui-cluster--between ui-gap-2"><h2 className="ui-section-title">{title}</h2>{action}</div>}
          {explanation && <p className="ui-secondary">{explanation}</p>}
        </div>
      )}
      {children}
    </section>
  );
}
