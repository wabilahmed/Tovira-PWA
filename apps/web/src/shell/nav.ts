/** The app's sections and their in-product names (brand §10 naming register). */
export type View =
  | 'clients'
  | 'today'
  | 'week'
  | 'ask'
  | 'promises'
  | 'meetings'
  | 'alerts'
  | 'bookscan'
  | 'ledger'
  | 'inventory'
  | 'capture'
  | 'getstarted'
  | 'settings';

export interface NavItem {
  view: View;
  label: string;
}

/** Mobile bottom-bar primaries — the taste screens + the capture path. */
export const PRIMARY: NavItem[] = [
  { view: 'clients', label: 'Clients' },
  { view: 'today', label: 'Today’s register' },
  { view: 'ask', label: 'Ask' },
  { view: 'bookscan', label: 'Book Scan' },
];

/** Reached through "More" on mobile; part of the full sidebar on desktop. */
export const OVERFLOW: NavItem[] = [
  { view: 'capture', label: 'Capture' },
  { view: 'week', label: 'The Monday Statement' },
  { view: 'promises', label: 'Promises' },
  { view: 'meetings', label: 'Meetings' },
  { view: 'alerts', label: 'Alerts' },
  { view: 'inventory', label: 'Inventory' },
  { view: 'ledger', label: 'The Ledger' },
  { view: 'settings', label: 'Settings' },
];

/** The full ordered nav for the desktop sidebar. */
export const SIDEBAR: NavItem[] = [
  { view: 'clients', label: 'Clients' },
  { view: 'capture', label: 'Capture' },
  { view: 'today', label: 'Today’s register' },
  { view: 'week', label: 'The Monday Statement' },
  { view: 'ask', label: 'Ask' },
  { view: 'promises', label: 'Promises' },
  { view: 'meetings', label: 'Meetings' },
  { view: 'alerts', label: 'Alerts' },
  { view: 'bookscan', label: 'Book Scan' },
  { view: 'inventory', label: 'Inventory' },
  { view: 'ledger', label: 'The Ledger' },
  { view: 'settings', label: 'Settings' },
];
