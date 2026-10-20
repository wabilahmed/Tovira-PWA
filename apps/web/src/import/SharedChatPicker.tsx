import { useEffect, useRef, useState } from 'react';
import type { BulkImportApi } from './bulkImportClient.js';

/**
 * [P36-2] A WhatsApp export shared into Tovira (Android share target) arrives with no client behind it.
 * This picker reads it the way import does — the server's deterministic parse, no model — to SUGGEST the
 * client whose name or number matches the counterpart, with "New client" (named after the counterpart) as
 * the alternative and every other client still pickable. The rep's choice continues on that client's page,
 * where the normal import (consent, alias prompt, mismatch check) runs. The picker never imports anything;
 * the staged copy it read is dropped as soon as the rep chooses.
 */
export function SharedChatPicker({
  api,
  clients,
  content = '',
  contentB64 = '',
  onChooseClient,
  onNewClient,
}: {
  api: BulkImportApi;
  clients: Array<{ id: string; name: string }>;
  /** The shared chat as text… */
  content?: string;
  /** …or a shared file's bytes, base64 (a .zip export). */
  contentB64?: string;
  onChooseClient: (clientId: string) => void;
  onNewClient: (name: string) => void;
}): JSX.Element {
  const [reading, setReading] = useState(true);
  const [suggested, setSuggested] = useState<{ id: string; name: string } | null>(null);
  const [newName, setNewName] = useState('');
  const batchRef = useRef('');

  useEffect(() => {
    let live = true;
    const id = `share${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
    batchRef.current = id;
    const bytes = contentB64 ? Uint8Array.from(atob(contentB64), (c) => c.charCodeAt(0)) : new TextEncoder().encode(content);
    void (async () => {
      try {
        await api.uploadFile(id, 0, 'shared chat', bytes);
        const parsed = await api.parse(id);
        const row = parsed.result.rows[0];
        if (!live || !row) return;
        if (row.matchClientId && (row.state === 'existing' || row.state === 'possible_match')) {
          setSuggested({ id: row.matchClientId, name: row.matchClientName ?? clients.find((c) => c.id === row.matchClientId)?.name ?? '' });
        }
        setNewName(row.suggestedName ?? row.counterpart ?? '');
      } catch { /* no suggestion — the rep still picks */ } finally {
        if (live) setReading(false);
      }
    })();
    return () => { live = false; };
  }, []);

  const drop = (): void => { if (batchRef.current) void api.abandon(batchRef.current); };
  const choose = (clientId: string): void => { drop(); onChooseClient(clientId); };
  const others = clients.filter((c) => c.id !== suggested?.id);

  return (
    <section aria-label="Choose the client" style={{ display: 'grid', gap: '0.75rem', maxWidth: 480 }}>
      <h2 style={{ margin: 0 }}>Who's this chat with?</h2>
      {reading && <p role="status" style={{ margin: 0, color: 'var(--text-secondary)' }}>Reading the chat…</p>}
      {suggested && (
        <div data-testid="shared-suggested" style={{ display: 'grid', gap: '0.25rem' }}>
          <span id="shared-suggested-hint" className="tov-stamp">Suggested — the chat is with this client</span>
          <button type="button" className="tov-primary" aria-describedby="shared-suggested-hint" onClick={() => choose(suggested.id)} style={{ textAlign: 'left' }}>
            {suggested.name}
          </button>
        </div>
      )}
      <form
        onSubmit={(e) => { e.preventDefault(); if (newName.trim()) { drop(); onNewClient(newName.trim()); } }}
        style={{ display: 'flex', gap: '0.5rem' }}
      >
        <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Client name" aria-label="New client name" style={{ flex: 1 }} />
        <button type="submit" disabled={!newName.trim()}>New client</button>
      </form>
      {others.length > 0 && (
        <div style={{ display: 'grid', gap: '0.5rem' }}>
          <span className="tov-stamp">Or one of your clients</span>
          {others.map((c) => (
            <button key={c.id} type="button" onClick={() => choose(c.id)} style={{ textAlign: 'left' }}>{c.name}</button>
          ))}
        </div>
      )}
    </section>
  );
}
