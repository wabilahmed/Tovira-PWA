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
}
