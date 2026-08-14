import type { ReactNode } from 'react';
import { useIsDesktop } from './useIsDesktop.js';
import { TabBar } from './TabBar.js';
import { Sidebar } from './Sidebar.js';
import type { View } from './nav.js';

/**
 * The responsive shell. Mobile: a centered 390-ish column with the content
 * scrolling above a pinned bottom tab bar (and a "Get started" nudge while the
 * book is unseeded). Desktop (≥1180px): the sidebar + a content pane, no tab bar.
 */
export function AppShell({
  view,
  onNavigate,
  needsSeeding,
  sidebarFooter,
  children,
}: {
  view: View;
  onNavigate: (v: View) => void;
  needsSeeding: boolean;
  sidebarFooter?: ReactNode;
  children: ReactNode;
}): JSX.Element {
  const isDesktop = useIsDesktop();

  if (isDesktop) {
    return (
      <div className="tov-shell">
        <Sidebar view={view} onNavigate={onNavigate} needsSeeding={needsSeeding} footer={sidebarFooter} />
        <div className="tov-content">{children}</div>
      </div>
    );
  }

  return (
    <div className="tov-appframe">
      <main className="tov-screen">{children}</main>
      {needsSeeding && view !== 'getstarted' && (
        <button type="button" className="tov-primary tov-getstarted" onClick={() => onNavigate('getstarted')}>
          Get started
        </button>
      )}
      <TabBar view={view} onNavigate={onNavigate} />
    </div>
  );
}
