import { useEffect, useState } from 'react';
import { LOCKED, type Locked } from '../billing/gated.js';
import { Locked as LockedCard } from '../billing/Locked.js';
import { whatsappLink } from '../whatsapp/waLink.js';
import { shareDraft, type InventoryItem, type InventoryFilter, type ShareResult, type InventoryShare } from './inventoryClient.js';

export interface InventoryClientRef { id: string; name: string; phone: string | null }

export interface InventoryApi {
  list(status?: InventoryFilter): Promise<InventoryItem[] | Locked>;
  create(title: string, description: string, quantity: number): Promise<InventoryItem>;
  edit(id: string, patch: Partial<{ title: string; description: string; quantity: number }>): Promise<InventoryItem | null>;
  share(itemId: string, clientId: string): Promise<ShareResult | null>;
  sharesForItem(itemId: string): Promise<InventoryShare[]>;
  setOutcome(shareId: string, outcome: 'bought' | 'declined' | 'no_response', quantityBought?: number): Promise<InventoryShare | null>;
}

const OUTCOME_LABEL: Record<InventoryShare['outcome'], string> = { pending: 'AWAITING', bought: 'BOUGHT', declined: 'DECLINED', no_response: 'NO REPLY' };

const STATUS_TAG: Record<NonNullable<InventoryItem['disabledReason']>, string> = {
  sold_out: 'OUT OF STOCK',
  unlisted: 'UNLISTED',
};

export function Inventory({ api, clients = [], onSubscribe, openLink = (url) => window.open(url, '_blank', 'noopener') }: {
  api: InventoryApi;
  clients?: InventoryClientRef[];
  onSubscribe: () => void;
  openLink?: (url: string) => void;
}): JSX.Element {
  const [filter, setFilter] = useState<InventoryFilter>('active');
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [locked, setLocked] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const clientName = (id: string): string => clients.find((c) => c.id === id)?.name ?? 'a client';

  async function shareItem(item: InventoryItem, clientId: string): Promise<void> {
    setWarning(null);
    const res = await api.share(item.id, clientId);
    if (!res) return;
    if (res.warning && res.warning.length) {
      const names = res.warning.map((w) => `${clientName(w.clientId)}, ${new Date(w.sharedAt).toLocaleDateString()}`).join('; ');
      setWarning(`Already shared with ${names}.`);
    }
    const client = clients.find((c) => c.id === clientId);
    openLink(whatsappLink(shareDraft(client?.name ?? 'there', item.title, item.description), client?.phone ?? undefined));
  }

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

      {warning && <p role="status" className="tov-inv-warn" style={{ color: 'var(--text-secondary)' }}>{warning}</p>}

      {items.length === 0 ? (
        <p style={{ color: 'var(--text-secondary)' }}>
          {filter === 'active' ? 'Nothing listed yet. Add your first item above.' : 'Nothing disabled.'}
        </p>
      ) : (
        <ul className="tov-list-plain">
          {items.map((item) => (
            <ItemCard key={item.id} item={item} clients={clients} api={api} editing={editing === item.id}
              onEditToggle={() => setEditing(editing === item.id ? null : item.id)}
              onSave={async (patch) => { await api.edit(item.id, patch); setEditing(null); await load(filter); }}
              onShare={(clientId) => shareItem(item, clientId)}
              onChanged={() => load(filter)} />
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

function ItemCard({ item, clients, api, editing, onEditToggle, onSave, onShare, onChanged }: {
  item: InventoryItem;
  clients: InventoryClientRef[];
  api: InventoryApi;
  editing: boolean;
  onEditToggle: () => void;
  onSave: (patch: Partial<{ title: string; description: string; quantity: number }>) => Promise<void>;
  onShare: (clientId: string) => void;
  onChanged: () => void;
}): JSX.Element {
  const disabled = item.status === 'disabled';
  const [t, setT] = useState(item.title);
  const [d, setD] = useState(item.description);
  const [q, setQ] = useState(String(item.quantity));
  const [picking, setPicking] = useState(false);
  const [pick, setPick] = useState(clients[0]?.id ?? '');
  const [history, setHistory] = useState<InventoryShare[] | null>(null);
  const clientName = (id: string): string => clients.find((c) => c.id === id)?.name ?? 'a client';
  async function toggleHistory(): Promise<void> {
    if (history) { setHistory(null); return; }
    setHistory(await api.sharesForItem(item.id));
  }
  async function outcome(shareId: string, o: 'bought' | 'declined'): Promise<void> {
    await api.setOutcome(shareId, o);
    setHistory(await api.sharesForItem(item.id));
    onChanged(); // a bought outcome may have decremented / disabled the item
  }

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
      ) : picking ? (
        <div className="tov-inv-add__row">
          <select aria-label="Share with client" value={pick} onChange={(e) => setPick(e.target.value)}>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button className="tov-primary" disabled={!pick} onClick={() => { onShare(pick); setPicking(false); }}>Send via WhatsApp</button>
          <button className="tov-link" onClick={() => setPicking(false)}>Cancel</button>
        </div>
      ) : (
        <div className="tov-inv-item__actions">
          {disabled ? (
            <button className="tov-link" onClick={onEditToggle}>Set quantity</button>
          ) : (
            <>
              <button className="tov-primary" disabled={clients.length === 0} onClick={() => setPicking(true)}>Share</button>
              <button className="tov-link" onClick={onEditToggle}>Edit</button>
            </>
          )}
          <button className="tov-link" onClick={() => void toggleHistory()}>{history ? 'Hide history' : 'History'}</button>
        </div>
      )}

      {history && (
        <ul className="tov-list-plain tov-inv-history">
          {history.length === 0 ? (
            <li style={{ color: 'var(--text-secondary)' }}>Not shared yet.</li>
          ) : history.map((s) => (
            <li key={s.id} className="tov-inv-shared">
              <span className="tov-inv-shared__title">{clientName(s.clientId)}</span>
              <span className="tov-stamp">{OUTCOME_LABEL[s.outcome]}</span>
              <span className="tov-mono tov-inv-shared__date">{new Date(s.sharedAt).toLocaleDateString()}</span>
              {s.outcome === 'pending' && (
                <span className="tov-inv-shared__set">
                  <button className="tov-link" onClick={() => void outcome(s.id, 'bought')}>Bought</button>
                  <button className="tov-link" onClick={() => void outcome(s.id, 'declined')}>Declined</button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Batch 2 (matching): the "N clients want something like this" line lands here once the
          requirements field + matching engine ship. Deliberately not rendered until then. */}
    </li>
  );
}
