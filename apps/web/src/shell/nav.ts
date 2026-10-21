/** The app's sections and their in-product names (brand §10 naming register). */
export type View =
  | 'clients'
  | 'today'
  | 'week'
  | 'find'
  /** [P39] legacy deep link only — `?view=ask` lands on Find. */
  | 'ask'
  | 'promises'
  | 'meetings'
  | 'alerts'
  | 'bookscan'
  | 'ledger'
  | 'inventory'
  | 'getstarted'
  | 'confirm'
  | 'settings'
  /** [P39] Settings sub-screens. */
  | 'subscription'
  | 'account'
  /** [P37] not a screen: More → "Take the tour again" replays the tour. Never a ?view= deep link. */
  | 'tour';

export interface NavItem {
  view: View;
  label: string;
}

/** [P39] The bottom nav: the same five on every screen, in this order (More is the fifth). Never replaced. */
export const PRIMARY: NavItem[] = [
  { view: 'clients', label: 'Clients' },
  { view: 'today', label: 'Today' },
  { view: 'find', label: 'Find' },
  { view: 'bookscan', label: 'Book Scan' },
];

/** Reached through "More" on mobile; part of the full sidebar on desktop. */
export const OVERFLOW: NavItem[] = [
  { view: 'week', label: 'The Monday Statement' },
  { view: 'promises', label: 'Promises' },
  { view: 'meetings', label: 'Meetings' },
  { view: 'alerts', label: 'Alerts' },
  { view: 'confirm', label: 'Needs your answer' }, // [P34-3 → P39] the full queue (Today shows the newest 3)
  { view: 'inventory', label: 'Inventory' },
  { view: 'ledger', label: 'The Ledger' },
  { view: 'settings', label: 'Settings' },
  { view: 'account', label: 'Account' },
  { view: 'tour', label: 'Take the tour again' },
];

/** [P39] A sub-screen keeps its parent tab highlighted (To Confirm → Today; Settings pages → More). */
export const PARENT_TAB: Partial<Record<View, View | 'more'>> = {
  confirm: 'today',
  getstarted: 'clients',
  week: 'more', promises: 'more', meetings: 'more', alerts: 'more', inventory: 'more', ledger: 'more',
  settings: 'more', subscription: 'more', account: 'more',
};
export function activeTab(view: View): View | 'more' {
  return PARENT_TAB[view] ?? view;
}

/** [P39] What a screen is called, for "← Back" labels. */
export const VIEW_LABEL: Partial<Record<View, string>> = {
  clients: 'Clients', today: 'Today', find: 'Find', bookscan: 'Book Scan', week: 'The Monday Statement', promises: 'Promises',
  meetings: 'Meetings', alerts: 'Alerts', inventory: 'Inventory', ledger: 'The Ledger', settings: 'Settings', account: 'Account',
  subscription: 'Subscription', confirm: 'Needs your answer', getstarted: 'Get started',
};

/** Every view the app knows, for validating a `?view=` deep-link (screenshots, shared links). */
export const VIEWS: readonly View[] = [
  'clients', 'today', 'week', 'find', 'ask', 'promises', 'meetings', 'alerts', 'bookscan', 'ledger', 'inventory', 'getstarted', 'confirm', 'settings', 'subscription', 'account',
];

/** True when `s` is a known View — guards an untrusted `?view=` query value. */
export function isView(s: string | null | undefined): s is View {
  return s != null && (VIEWS as readonly string[]).includes(s);
}

/** The full ordered nav for the desktop sidebar. */
export const SIDEBAR: NavItem[] = [
  { view: 'clients', label: 'Clients' },
  { view: 'today', label: 'Today' },
  { view: 'week', label: 'The Monday Statement' },
  { view: 'find', label: 'Find' },
  { view: 'promises', label: 'Promises' },
  { view: 'meetings', label: 'Meetings' },
  { view: 'alerts', label: 'Alerts' },
  { view: 'bookscan', label: 'Book Scan' },
  { view: 'inventory', label: 'Inventory' },
  { view: 'ledger', label: 'The Ledger' },
  { view: 'settings', label: 'Settings' },
  { view: 'account', label: 'Account' },
  { view: 'tour', label: 'Take the tour again' },
];
