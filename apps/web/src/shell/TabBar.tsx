import { useState } from 'react';
import { PRIMARY, OVERFLOW, type NavItem, type View } from './nav.js';

/**
 * The mobile bottom tab bar (brand §6): four primary tabs + More. The active
 * tab carries a 2px brass top rule — a state indicator, not a competing brass
 * element. When an overflow section is open it takes the fourth slot (the board
 * shows "Alerts" replacing "Book Scan" while on Alerts). More opens a sheet of
 * the remaining sections.
 */
export function TabBar({ view, onNavigate }: { view: View; onNavigate: (v: View) => void }): JSX.Element {
  const [moreOpen, setMoreOpen] = useState(false);
  const activeOverflow = OVERFLOW.find((i) => i.view === view);
  const tabs: NavItem[] = activeOverflow
    ? [PRIMARY[0]!, PRIMARY[1]!, PRIMARY[2]!, activeOverflow]
    : PRIMARY;

  function go(v: View): void {
    onNavigate(v);
    setMoreOpen(false);
  }

  return (
    <>
      {moreOpen && (
        <div className="tov-sheet" aria-label="More sections">
          {OVERFLOW.map((i) => (
            <button
              key={i.view}
              type="button"
              className="tov-sheet__item"
              aria-current={view === i.view ? 'page' : undefined}
              onClick={() => go(i.view)}
            >
              {i.label}
            </button>
          ))}
        </div>
      )}
      <nav className="tov-tabbar" aria-label="Sections">
        {tabs.map((i) => (
          <button
            key={i.view}
            type="button"
            className="tov-tab"
            aria-current={view === i.view ? 'page' : undefined}
            data-active={view === i.view || undefined}
            onClick={() => go(i.view)}
          >
            {i.label}
          </button>
        ))}
        <button
          type="button"
          className="tov-tab"
          aria-expanded={moreOpen}
          data-active={moreOpen || undefined}
          onClick={() => setMoreOpen((s) => !s)}
        >
          More
        </button>
      </nav>
    </>
  );
}
