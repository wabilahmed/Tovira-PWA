/**
 * A quiet count on a nav item — the strong, unseen inventory matches (INV-MATCH). Renders
 * nothing at zero: the badge is a promise that something new is waiting, so it must be honest.
 */
export function NavBadge({ count, label = 'unseen' }: { count?: number; label?: string }): JSX.Element | null {
  if (!count || count <= 0) return null;
  return (
    <span className="tov-navbadge" aria-label={`${count} ${label}`} data-testid="nav-badge">
      {count > 9 ? '9+' : count}
    </span>
  );
}
