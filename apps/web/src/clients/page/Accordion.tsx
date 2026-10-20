import { useId, type ReactNode } from 'react';

/**
 * [P36-5] One client-page section: a real accordion header (a button with aria-expanded / aria-controls,
 * keyboard-operable by being a button, a visible focus ring from the theme) carrying a plain title and a short
 * summary, so the rep knows what's inside without opening it. Empty sections stay on the page ("Nothing yet")
 * so every client's page has the same shape.
 */
export function Accordion({ id, title, summary, open, onToggle, children }: {
  id: string;
  title: string;
  /** The one-line summary; null/empty → "Nothing yet". */
  summary: string | null;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}): JSX.Element {
  const panelId = `${useId()}-panel`;
  return (
    <section className="tov-acc" data-testid={`section-${id}`} data-open={open || undefined}>
      <h2 className="tov-acc__h">
        <button type="button" className="tov-acc__btn" aria-expanded={open} aria-controls={panelId} onClick={onToggle}>
          <span className="tov-acc__title">{title}</span>
          <span className="tov-acc__summary" data-testid={`section-${id}-summary`} dir="auto">{summary && summary.trim() ? summary : 'Nothing yet'}</span>
          <span className="tov-acc__chev" aria-hidden="true">{open ? '▴' : '▾'}</span>
        </button>
      </h2>
      <div id={panelId} className="tov-acc__panel" role="region" aria-label={title} hidden={!open}>
        {open && children}
      </div>
    </section>
  );
}
