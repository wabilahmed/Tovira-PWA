import { useEffect, useState } from 'react';
import { LOCKED, type Locked } from '../billing/gated.js';
import { Locked as LockedCard } from '../billing/Locked.js';
import type { InventoryItem, InventoryFilter } from './inventoryClient.js';

export interface InventoryApi {
  list(status?: InventoryFilter): Promise<InventoryItem[] | Locked>;
  create(title: string, description: string, quantity: number): Promise<InventoryItem>;
  edit(id: string, patch: Partial<{ title: string; description: string; quantity: number }>): Promise<InventoryItem | null>;
}

const STATUS_TAG: Record<NonNullable<InventoryItem['disabledReason']>, string> = {
  sold_out: 'OUT OF STOCK',
  unlisted: 'UNLISTED',
};

export function Inventory({ api, onSubscribe }: { api: InventoryApi; onSubscribe: () => void }): JSX.Element {
  const [filter, setFilter] = useState<InventoryFilter>('active');
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [locked, setLocked] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  async function load(f: InventoryFilter): Promise<void> {
    const res = await api.list(f);
    if (res === LOCKED) { setLocked(true); return; }
    setLocked(false);
    setItems(res);
  }
  useEffect(() => { void load(filter); }, [filter]);

  async function add(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    const q = Number(quantity);
    if (!title.trim() || !description.trim()) { setError('A title and description are both needed.'); return; }
    if (!Number.isInteger(q) || q < 0) { setError('Quantity must be a whole number, zero or more.'); return; }
    try {
      await api.create(title.trim(), description.trim(), q);
      setTitle(''); setDescription(''); setQuantity('1');
      await load('active');
      setFilter('active');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add the item.');
    }
  }

  if (locked) {
    return (
      <section>
        <ScreenHead />
        <LockedCard onSubscribe={onSubscribe} />
        <AddForm {...{ title, setTitle, description, setDescription, quantity, setQuantity, error, add }} />
      </section>
    );
  }

  return (
    <section>
      <ScreenHead />
      <AddForm {...{ title, setTitle, description, setDescription, quantity, setQuantity, error, add }} />

      <div className="tov-filter" role="tablist" aria-label="Inventory filter">
        {(['active', 'disabled'] as const).map((f) => (
          <button key={f} role="tab" aria-selected={filter === f} className={`tov-link${filter === f ? ' tov-link--on' : ''}`} onClick={() => setFilter(f)}>
            {f === 'active' ? 'Active' : 'Disabled'}
          </button>
        ))}
      </div>

      {items.length === 0 ? (
        <p style={{ color: 'var(--text-secondary)' }}>
          {filter === 'active' ? 'Nothing listed yet. Add your first item above.' : 'Nothing disabled.'}
        </p>
      ) : (
        <ul className="tov-list-plain">
          {items.map((item) => (
            <ItemCard key={item.id} item={item} editing={editing === item.id} onEditToggle={() => setEditing(editing === item.id ? null : item.id)}
              onSave={async (patch) => { await api.edit(item.id, patch); setEditing(null); await load(filter); }} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ScreenHead(): JSX.Element {
  return (
    <header className="tov-screenhead">
      <div className="tov-stamp">Inventory</div>
      <h2>What you have to sell</h2>
      <p style={{ color: 'var(--text-secondary)' }}>Your list — title, a description, and how many. Tovira keeps it ready to match what clients ask for.</p>
    </header>
  );
}

interface FormProps {
  title: string; setTitle: (v: string) => void;
  description: string; setDescription: (v: string) => void;
  quantity: string; setQuantity: (v: string) => void;
  error: string | null; add: (e: React.FormEvent) => void;
}
function AddForm(p: FormProps): JSX.Element {
  return (
    <form onSubmit={p.add} className="tov-inv-add">
      <input aria-label="Item title" placeholder="Title (e.g. Marina Heights 402)" value={p.title} onChange={(e) => p.setTitle(e.target.value)} />
      <textarea aria-label="Item description" placeholder="Description — what it is, so Tovira can match it" value={p.description} onChange={(e) => p.setDescription(e.target.value)} rows={2} />
      <div className="tov-inv-add__row">
        <input aria-label="Quantity" className="tov-mono" type="number" min={0} step={1} value={p.quantity} onChange={(e) => p.setQuantity(e.target.value)} style={{ width: '5rem' }} />
        <button type="submit" className="tov-primary">Add item</button>
      </div>
      {p.error && <p style={{ color: 'var(--claret)', margin: '0.5rem 0 0' }}>{p.error}</p>}
    </form>
  );
}

function ItemCard({ item, editing, onEditToggle, onSave }: {
  item: InventoryItem;
  editing: boolean;
  onEditToggle: () => void;
  onSave: (patch: Partial<{ title: string; description: string; quantity: number }>) => Promise<void>;
}): JSX.Element {
  const disabled = item.status === 'disabled';
  const [t, setT] = useState(item.title);
  const [d, setD] = useState(item.description);
  const [q, setQ] = useState(String(item.quantity));

  return (
    <li className="tov-card tov-inv-item">
      <div className="tov-inv-item__head">
        <span className="tov-inv-item__title" style={{ color: disabled ? 'var(--text-secondary)' : 'var(--text-primary)' }}>{item.title}</span>
        {disabled && item.disabledReason && <span className="tov-stamp">{STATUS_TAG[item.disabledReason]}</span>}
        <span className="tov-mono tov-inv-item__qty" title="Quantity in stock">{item.quantity}</span>
      </div>
      <p style={{ color: 'var(--text-secondary)', margin: '0.3rem 0 0.6rem' }}>{item.description}</p>

      {editing ? (
        <div className="tov-inv-item__edit">
          <input aria-label="Edit title" value={t} onChange={(e) => setT(e.target.value)} />
          <textarea aria-label="Edit description" value={d} onChange={(e) => setD(e.target.value)} rows={2} />
          <div className="tov-inv-add__row">
            <input aria-label="Edit quantity" className="tov-mono" type="number" min={0} step={1} value={q} onChange={(e) => setQ(e.target.value)} style={{ width: '5rem' }} />
            <button className="tov-primary" onClick={() => void onSave({ title: t.trim(), description: d.trim(), quantity: Number(q) })}>Save</button>
            <button className="tov-link" onClick={onEditToggle}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="tov-inv-item__actions">
          {/* Share (active) lands in feat(INV-SHARE); Edit / Set quantity is the interaction now. */}
          <button className="tov-link" onClick={onEditToggle}>{disabled ? 'Set quantity' : 'Edit'}</button>
        </div>
      )}
    </li>
  );
}
