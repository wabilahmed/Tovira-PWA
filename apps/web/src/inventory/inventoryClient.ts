import { LOCKED, type Locked } from '../billing/gated.js';

export interface InventoryItem {
  id: string;
  title: string;
  description: string;
  quantity: number;
  status: 'active' | 'disabled';
  disabledReason: 'sold_out' | 'unlisted' | null;
  createdAt: number;
  updatedAt: number;
}

export type InventoryFilter = 'active' | 'disabled';

export interface InventoryShare {
  id: string;
  itemId: string;
  clientId: string;
  sharedAt: number;
  outcome: 'pending' | 'bought' | 'declined' | 'no_response';
  outcomeSetBy: 'rep' | 'confirmed_suggestion' | null;
  quantityBought: number | null;
}
/** A share plus (when re-sharing an over-committed item) the prior pending shares to flag. */
export interface ShareResult {
  share: InventoryShare;
  warning: InventoryShare[] | null;
}

/** Talks to /inventory. Reads are gated (402 → LOCKED); create/edit stay open on a lapse. */
export class InventoryClient {
  constructor(private readonly baseUrl: string = '') {}
  private url(path: string): string { return `${this.baseUrl}${path}`; }

  async list(status?: InventoryFilter): Promise<InventoryItem[] | Locked> {
    try {
      const res = await fetch(this.url(`/inventory${status ? `?status=${status}` : ''}`), { credentials: 'include' });
      if (res.status === 402) return LOCKED;
      if (res.status !== 200) return [];
      return ((await res.json()) as { items: InventoryItem[] }).items;
    } catch {
      return [];
    }
  }

  async create(title: string, description: string, quantity: number): Promise<InventoryItem> {
    const res = await fetch(this.url('/inventory'), {
      method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ title, description, quantity }),
    });
    if (!res.ok) throw new Error(((await res.json()) as { message?: string }).message ?? 'Could not add the item.');
    return (await res.json()) as InventoryItem;
  }

  async edit(id: string, patch: Partial<{ title: string; description: string; quantity: number }>): Promise<InventoryItem | null> {
    const res = await fetch(this.url(`/inventory/${id}`), {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, credentials: 'include',
      body: JSON.stringify(patch),
    });
    if (res.status !== 200) return null;
    return (await res.json()) as InventoryItem;
  }

  /** Record a share of an item to a client. Never reserves; returns the share + any warning. */
  async share(itemId: string, clientId: string): Promise<ShareResult | null> {
    const res = await fetch(this.url(`/inventory/${itemId}/shares`), {
      method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ clientId }),
    });
    if (res.status !== 201) return null;
    return (await res.json()) as ShareResult;
  }

  /** An item's share history (newest first). */
  async sharesForItem(itemId: string): Promise<InventoryShare[]> {
    const res = await fetch(this.url(`/inventory/${itemId}/shares`), { credentials: 'include' });
    if (res.status !== 200) return [];
    return ((await res.json()) as { shares: InventoryShare[] }).shares;
  }

  /** Items shared with a client (client-detail section), enriched with the item's title/status. */
  async sharesForClient(clientId: string): Promise<SharedWithClient[]> {
    const res = await fetch(this.url(`/inventory/by-client/${clientId}`), { credentials: 'include' });
    if (res.status !== 200) return [];
    return ((await res.json()) as { shares: SharedWithClient[] }).shares;
  }

  async setOutcome(shareId: string, outcome: 'bought' | 'declined' | 'no_response', quantityBought?: number): Promise<InventoryShare | null> {
    const res = await fetch(this.url(`/inventory/shares/${shareId}`), {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ outcome, ...(quantityBought !== undefined ? { quantityBought } : {}) }),
    });
    if (res.status !== 200) return null;
    return (await res.json()) as InventoryShare;
  }
}

export interface SharedWithClient extends InventoryShare {
  itemTitle: string;
  itemStatus: 'active' | 'disabled';
}

/** The template WhatsApp draft for an item share — no model call (Tovira never sends). */
export function shareDraft(clientName: string, title: string, description: string): string {
  return `Hi ${clientName}, I've got ${title} — ${description}. Thought it might be a fit. Want the details?`;
}
