/**
 * [P50-2] "Is 'Khalid' in this chat the same person as Khalid Al Mansoori?" One question per (client, person) pair:
 * pending until the rep answers; 'same' folds them into the client, 'different' keeps them apart and is never asked again.
 */
export type PersonLinkStatus = 'pending' | 'same' | 'different';
export interface PersonLinkQuestion {
  id: string;
  clientId: string;
  noteId: string | null;
  personName: string;
  /** foldKey(personName): the pair's identity. */
  personKey: string;
  /** The receipt: where the name appears. */
  quote: string | null;
  quoteAt: string | null;
  status: PersonLinkStatus;
  createdAt: number;
}
export interface NewPersonLinkQuestion { clientId: string; noteId: string | null; personName: string; personKey: string; quote: string | null; quoteAt: string | null }

export interface PersonLinkRepository {
  /** Ask once: a no-op (false) when this pair was ever asked, answered or not. */
  askOnce(userId: string, q: NewPersonLinkQuestion): Promise<boolean>;
  listPending(userId: string): Promise<PersonLinkQuestion[]>;
  findById(userId: string, id: string): Promise<PersonLinkQuestion | null>;
  /** Record the answer on a pending question; false when it is not pending (or not this rep's). */
  answer(userId: string, id: string, status: 'same' | 'different', atMs: number): Promise<boolean>;
  purgeUser(userId: string): Promise<void>;
}
