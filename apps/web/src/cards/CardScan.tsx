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
  onCreateClient: (name: string, phone?: string) => Promise<unknown>;
}): JSX.Element {
  const [contact, setContact] = useState<ScannedContact | null>(null);
  const [phone, setPhone] = useState('');
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
    setPhone(result.contact.phone ?? ''); // offer the scanned phone to confirm/edit
    setState('ready');
  }

  async function save(): Promise<void> {
    if (!contact?.name) return;
    const trimmed = phone.trim();
    // Preserve the single-arg contract when there's no phone (never save a blank).
    if (trimmed) await onCreateClient(contact.name, trimmed);
    else await onCreateClient(contact.name);
    setState('saved');
    setContact(null);
    setPhone('');
  }

  return (
    <section aria-label="Scan a business card">
      <label>
        Scan a business card
        <input type="file" accept="image/*" aria-label="Business card photo" onChange={onFile} />
      </label>

      {state === 'scanning' && <p>Reading the card…</p>}
      {state === 'error' && <p role="alert" style={{ color: 'var(--claret)' }}>Couldn't read that image — try again.</p>}
      {state === 'not_card' && <p role="alert">That doesn't look like a business card.</p>}
      {state === 'saved' && <p style={{ color: 'var(--green)' }}>Contact created.</p>}

      {state === 'ready' && contact && (
        <div data-testid="card-preview" className="tov-card" style={{ margin: '0.75rem 0' }}>
          <p style={{ margin: 0 }}><strong>{contact.name ?? '(no name found)'}</strong></p>
          {contact.title && <div>{contact.title}</div>}
          {contact.email && <div>{contact.email}</div>}
          <label style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', marginTop: '0.35rem' }}>
            Phone
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+971 50 123 4567"
              aria-label="Contact phone"
              style={{ minWidth: 180 }}
            />
          </label>
          <button className="tov-primary" onClick={() => void save()} disabled={!contact.name} style={{ marginTop: '0.5rem' }}>
            Create client from card
          </button>
          {!contact.name && <p style={{ color: 'var(--amber)' }}>No name detected — add it manually instead.</p>}
        </div>
      )}
    </section>
  );
}
