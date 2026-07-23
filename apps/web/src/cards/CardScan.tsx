import { useState } from 'react';
import type { CardScanResult, ScannedContact } from './cardsClient.js';

export interface CardsApi {
  scan(image: Blob): Promise<CardScanResult | null>;
}

/** Business-card scan (P4-5): snap a card → structured contact → CONFIRM before
 *  creating the client. Never saves a guessed contact silently. */
export function CardScan({
  api,
  onCreateClient,
}: {
  api: CardsApi;
  onCreateClient: (name: string) => Promise<unknown>;
}): JSX.Element {
  const [contact, setContact] = useState<ScannedContact | null>(null);
  const [state, setState] = useState<'idle' | 'scanning' | 'not_card' | 'error' | 'ready' | 'saved'>('idle');

  async function onFile(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    if (!file) return;
    setState('scanning');
    setContact(null);
    const result = await api.scan(file);
    if (!result) return setState('error');
    if (!result.isCard || !result.contact) return setState('not_card');
    setContact(result.contact);
    setState('ready');
  }

  async function save(): Promise<void> {
    if (!contact?.name) return;
    await onCreateClient(contact.name);
    setState('saved');
    setContact(null);
  }

  return (
    <section aria-label="Scan a business card">
      <label>
        Scan a business card
        <input type="file" accept="image/*" aria-label="Business card photo" onChange={onFile} />
      </label>

      {state === 'scanning' && <p>Reading the card…</p>}
      {state === 'error' && <p role="alert" style={{ color: 'crimson' }}>Couldn't read that image — try again.</p>}
      {state === 'not_card' && <p role="alert">That doesn't look like a business card.</p>}
      {state === 'saved' && <p style={{ color: 'green' }}>Contact created.</p>}

      {state === 'ready' && contact && (
        <div data-testid="card-preview" style={box}>
          <p style={{ margin: 0 }}><strong>{contact.name ?? '(no name found)'}</strong></p>
          {contact.title && <div>{contact.title}</div>}
          {contact.email && <div>{contact.email}</div>}
          {contact.phone && <div>{contact.phone}</div>}
          <button onClick={() => void save()} disabled={!contact.name} style={{ marginTop: '0.5rem' }}>
            Create client from card
          </button>
          {!contact.name && <p style={{ color: '#92400e' }}>No name detected — add it manually instead.</p>}
        </div>
      )}
    </section>
  );
}

const box: React.CSSProperties = { border: '1px solid #e5e7eb', borderRadius: 8, padding: '0.75rem 1rem', margin: '0.75rem 0' };
