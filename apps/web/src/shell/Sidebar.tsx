import type { ReactNode } from 'react';
import { SIDEBAR, type View } from './nav.js';
import { Wordmark } from '../components/Wordmark.js';

/**
 * The desktop nav (≥1180px): the Fraunces wordmark over the full section list,
 * active row marked by a 2px brass inline-start rule. No bottom tab bar here.
 */
export function Sidebar({
  view,
  onNavigate,
  needsSeeding,
  footer,
}: {
  view: View;
  onNavigate: (v: View) => void;
  needsSeeding: boolean;
  footer?: ReactNode;
}): JSX.Element {
  return (
    <aside className="tov-sidebar" aria-label="Sections">
      <div className="tov-sidebar__brand"><Wordmark /></div>
      <nav className="tov-sidebar__nav">
        {needsSeeding && (
          <button
            type="button"
            className="tov-sidebar__item"
            data-active={view === 'getstarted' || undefined}
            aria-current={view === 'getstarted' ? 'page' : undefined}
            onClick={() => onNavigate('getstarted')}
          >
            Get started
          </button>
        )}
        {SIDEBAR.map((i) => (
          <button
            key={i.view}
            type="button"
            className="tov-sidebar__item"
            data-active={view === i.view || undefined}
            aria-current={view === i.view ? 'page' : undefined}
            onClick={() => onNavigate(i.view)}
          >
            {i.label}
          </button>
        ))}
      </nav>
      {footer && <div className="tov-sidebar__footer">{footer}</div>}
    </aside>
  );
}
