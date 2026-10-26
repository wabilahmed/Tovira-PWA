import { useEffect, useState } from 'react';
import { LOCKED, type Locked } from '../billing/gated.js';
import { Locked as LockedCard } from '../billing/Locked.js';
import type { Plan } from '../billing/plans.js';
import { whatsappLink } from '../whatsapp/waLink.js';
import { shareDraft, type InventoryItem, type InventoryFilter, type ShareResult, type InventoryShare, type MatchSuggestion as Match } from './inventoryClient.js';
import { ItemMatches } from './ItemMatches.js';
import { Page, PageHeader } from '../ui/PageHeader.js';
import { Badge, Button, EmptyState, Sheet, TextArea, TextInput } from '../ui/index.js';

export interface InventoryClientRef { id: string; name: string; phone: string | null }

export interface InventoryApi {
  list(status?: InventoryFilter): Promise<InventoryItem[] | Locked>;
  create(title: string, description: string, quantity: number | null): Promise<InventoryItem>;
  edit(id: string, patch: Partial<{ title: string; description: string; quantity: number | null }>): Promise<InventoryItem | null>;
  share(itemId: string, clientId: string): Promise<ShareResult | null>;
  sharesForItem(itemId: string): Promise<InventoryShare[]>;
  setOutcome(shareId: string, outcome: 'bought' | 'declined' | 'no_response', quantityBought?: number): Promise<InventoryShare | null>;
  // INV-MATCH (A5) — optional so existing partial test mocks keep compiling; the reverse
  // "clients who asked for this" section renders only when the engine is wired.
  itemMatches?(itemId: string): Promise<Match[]>;
  shareFromSuggestion?(matchId: string): Promise<ShareResult | null>;
  dismissMatch?(matchId: string): Promise<boolean>;
}

const OUTCOME_LABEL: Record<InventoryShare['outcome'], string> = { pending: 'Waiting', bought: 'Bought', declined: 'Declined', no_response: 'No reply' };

/** [P46-1] Tabs: Available (listed) and Paused (sold out or unlisted). The stored statuses stay active / disabled. */
const TABS: Array<{ value: InventoryFilter; label: string }> = [{ value: 'active', label: 'Available' }, { value: 'disabled', label: 'Paused' }];

export function Inventory({ api, clients = [], onSubscribe, openLink = (url) => window.open(url, '_blank', 'noopener'), back }: {
  api: InventoryApi;
  clients?: InventoryClientRef[];
  onSubscribe: (plan: Plan) => void;
  openLink?: (url: string) => void;
  /** [P46-1] "← More" on a phone (reopens the More sheet). */
  back?: { label: string; onBack: () => void };
}): JSX.Element {
  const [filter, setFilter] = useState<InventoryFilter>('active');
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [locked, setLocked] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [quantity, setQuantity] = useState(''); // [P43-4] optional: blank = not counted
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
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
    const q = quantity.trim() === '' ? null : Number(quantity);
    if (!title.trim() || !description.trim()) { setError('A title and description are both needed.'); return; }
    if (q !== null && (!Number.isInteger(q) || q < 0)) { setError('Quantity must be a whole number, zero or more.'); return; }
    try {
      await api.create(title.trim(), description.trim(), q);
      setTitle(''); setDescription(''); setQuantity(''); setAdding(false);
      await load('active');
      setFilter('active');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add the item.');
    }
  }

  const form = { title, setTitle, description, setDescription, quantity, setQuantity, error, add };
  const addSheet = (
    <Sheet open={adding} onClose={() => { setAdding(false); setError(null); }} title="Add an item">
      <ItemForm {...form} submitLabel="Add item" />
    </Sheet>
  );
  const head = <ScreenHead back={back} onAdd={() => setAdding(true)} />;

  if (locked) {
    return (
      <Page testId="inventory-page" label="Inventory">
        {head}
        <LockedCard onSubscribe={onSubscribe} />
        {addSheet}
      </Page>
    );
  }

  return (
    <Page testId="inventory-page" label="Inventory">
      {head}
      {addSheet}

      <div className="ui-tabs" role="tablist" aria-label="Inventory filter">
        {TABS.map((t) => (
          <button key={t.value} type="button" role="tab" className="ui-tab" aria-selected={filter === t.value} onClick={() => setFilter(t.value)}>{t.label}</button>
        ))}
      </div>

      {warning && <p role="status" className="ui-secondary">{warning}</p>}

      {items.length === 0 ? (
        filter === 'active' ? (
          <EmptyState data-testid="inventory-empty" title="Nothing listed yet.">
            <span className="ui-block">When a client asks for something like an item here, Tovira suggests it on their page.</span>
            <span className="ui-block">Share an item with a client and Tovira opens a WhatsApp message for you to send.</span>
          </EmptyState>
        ) : <EmptyState data-testid="inventory-empty" title="Nothing paused." />
      ) : (
        <ul className="ui-plainlist ui-stack ui-gap-3">
          {items.map((item) => (
            <ItemCard key={item.id} item={item} clients={clients} api={api} editing={editing === item.id}
              onEditToggle={() => setEditing(editing === item.id ? null : item.id)}
              onSave={async (patch) => { await api.edit(item.id, patch); setEditing(null); await load(filter); }}
              onShare={(clientId) => shareItem(item, clientId)}
              onChanged={() => load(filter)} />
          ))}
        </ul>
      )}
    </Page>
  );
}

function ScreenHead({ back, onAdd }: { back?: { label: string; onBack: () => void }; onAdd: () => void }): JSX.Element {
  return (
    <>
      <PageHeader title="Inventory" subtitle="What you have to sell" {...(back ? { back } : {})} action={<Button variant="primary" size="sm" onClick={onAdd}>+ Add item</Button>} />
      <p className="ui-secondary">List what you sell. When a client asks for something similar, Tovira suggests it on their page.</p>
    </>
  );
}

interface FormProps {
  title: string; setTitle: (v: string) => void;
  description: string; setDescription: (v: string) => void;
  quantity: string; setQuantity: (v: string) => void;
  error: string | null; add: (e: React.FormEvent) => void;
  submitLabel: string;
}
/** [P46-1] The add / edit fields, labelled above each field, in a Sheet. */
function ItemForm(p: FormProps): JSX.Element {
  return (
    <form onSubmit={p.add} className="ui-stack ui-gap-3">
      <TextInput label="Title" placeholder="e.g. Premium plan" value={p.title} onChange={(e) => p.setTitle(e.target.value)} />
      <TextArea label="Description" placeholder="What it is, so Tovira can match it" value={p.description} onChange={(e) => p.setDescription(e.target.value)} rows={3} />
      <TextInput label="Quantity (optional)" type="number" inputMode="numeric" min={0} step={1} value={p.quantity} onChange={(e) => p.setQuantity(e.target.value)} />
      {p.error && <p role="alert" className="ui-danger">{p.error}</p>}
      <Button type="submit" variant="primary" block>{p.submitLabel}</Button>
    </form>
  );
}

function ItemCard({ item, clients, api, editing, onEditToggle, onSave, onShare, onChanged }: {
  item: InventoryItem;
  clients: InventoryClientRef[];
  api: InventoryApi;
  editing: boolean;
  onEditToggle: () => void;
  onSave: (patch: Partial<{ title: string; description: string; quantity: number | null }>) => Promise<void>;
  onShare: (clientId: string) => void;
  onChanged: () => void;
}): JSX.Element {
  const disabled = item.status === 'disabled';
  const [t, setT] = useState(item.title);
  const [d, setD] = useState(item.description);
  const [q, setQ] = useState(item.quantity === null ? '' : String(item.quantity));
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

  const soldOut = disabled && item.quantity === 0;
  const [editError, setEditError] = useState<string | null>(null);
  function saveEdit(e: React.FormEvent): void {
    e.preventDefault();
    const qty = q.trim() === '' ? null : Number(q);
    if (!t.trim() || !d.trim()) { setEditError('A title and description are both needed.'); return; }
    if (qty !== null && (!Number.isInteger(qty) || qty < 0)) { setEditError('Quantity must be a whole number, zero or more.'); return; }
    void onSave({ title: t.trim(), description: d.trim(), quantity: qty });
  }

  return (
    <li className="ui-card ui-stack ui-gap-2" style={{ padding: 'var(--space-4)' }}>
      <div className="ui-cluster ui-cluster--between ui-gap-2">
        <span className="ui-strong" dir="auto" style={{ color: disabled ? 'var(--text-secondary)' : undefined }}>{item.title}</span>
        {soldOut && <Badge>Sold out</Badge>}
        {disabled && item.disabledReason === 'unlisted' && <Badge>Not listed</Badge>}
      </div>
      <p className="ui-secondary" dir="auto" style={{ margin: 0 }}>{item.description}</p>
      {/* [P43-4 → P46-1] the quantity only when it is counted, in words */}
      {item.quantity !== null && item.quantity > 0 && <p className="ui-caption" data-testid="item-qty" style={{ margin: 0 }}>{item.quantity} left</p>}

      <Sheet open={editing} onClose={onEditToggle} title={`Edit ${item.title}`}>
        <ItemForm title={t} setTitle={setT} description={d} setDescription={setD} quantity={q} setQuantity={setQ} error={editError} add={saveEdit} submitLabel="Save" />
      </Sheet>

      {picking ? (
        <div className="ui-stack ui-gap-2">
          <select className="ui-input ui-native-select" aria-label="Share with client" value={pick} onChange={(e) => setPick(e.target.value)}>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <div className="ui-cluster ui-gap-2">
            <Button variant="primary" size="sm" disabled={!pick} onClick={() => { onShare(pick); setPicking(false); }}>Send via WhatsApp</Button>
            <Button variant="text" size="sm" onClick={() => setPicking(false)}>Cancel</Button>
          </div>
        </div>
      ) : (
        <div className="ui-actions--equal" data-testid="item-actions">
          <Button size="sm" disabled={disabled || clients.length === 0} onClick={() => setPicking(true)}>Share</Button>
          <Button size="sm" onClick={onEditToggle}>Edit</Button>
          <Button size="sm" aria-expanded={!!history} onClick={() => void toggleHistory()}>History</Button>
        </div>
      )}

      {history && (
        <ul className="ui-plainlist ui-stack ui-gap-2">
          {history.length === 0 ? (
            <li className="ui-secondary">Not shared yet.</li>
          ) : history.map((s) => (
            <li key={s.id} className="ui-cluster ui-gap-2" style={{ flexWrap: 'wrap' }}>
              <span className="ui-strong">{clientName(s.clientId)}</span>
              <Badge>{OUTCOME_LABEL[s.outcome]}</Badge>
              <span className="ui-caption">{new Date(s.sharedAt).toLocaleDateString()}</span>
              {s.outcome === 'pending' && (
                <span className="ui-cluster ui-gap-2">
                  <Button variant="text" size="sm" onClick={() => void outcome(s.id, 'bought')}>Bought</Button>
                  <Button variant="text" size="sm" onClick={() => void outcome(s.id, 'declined')}>Declined</Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* INV-MATCH reverse direction: the clients who asked for something like this item. */}
      {api.itemMatches && api.shareFromSuggestion && api.dismissMatch && (
        <ItemMatches
          api={{ itemMatches: api.itemMatches.bind(api), shareFromSuggestion: api.shareFromSuggestion.bind(api), dismissMatch: api.dismissMatch.bind(api) }}
          itemId={item.id}
          clientName={clientName}
        />
      )}
    </li>
  );
}
