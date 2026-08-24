import { hapticTick } from '../haptics.js';
import { useState } from 'react';
import type { CardScanResult, ScannedContact } from './cardsClient.js';
import { Locked } from '../billing/Locked.js';
import { LOCKED } from '../billing/gated.js';

export interface CardsApi {
  scan(image: Blob): Promise<CardScanResult | typeof LOCKED | null>;
}

/** Business-card scan (P4-5): snap a card → structured contact → CONFIRM before
 *  creating the client. Never saves a guessed contact silently. */
export function CardScan({
  api,
  onCreateClient,
  onSubscribe,
}: {
  api: CardsApi;
  /** Extras carry the scanned title/email so they aren't discarded — the client
   *  record has no such fields, so the app preserves them elsewhere (a note). */
  onCreateClient: (name: string, phone?: string, extras?: { title: string | null; email: string | null }) => Promise<unknown>;
  /** Navigate to Billing — used by the embedded <Locked> state (LOCKED-EMBEDDED). */
  onSubscribe?: () => void;
}): JSX.Element {
  const [contact, setContact] = useState<ScannedContact | null>(null);
  const [phone, setPhone] = useState('');
  const [state, setState] = useState<'idle' | 'scanning' | 'not_card' | 'error' | 'ready' | 'saved' | 'locked'>('idle');

  async function onFile(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    if (!file) return;
    setState('scanning');
    setContact(null);
    const result = await api.scan(file);
    if (result === LOCKED) return setState('locked'); // trial lapsed → <Locked>
    if (!result) return setState('error');
    if (!result.isCard || !result.contact) return setState('not_card');
    setContact(result.contact);
    setPhone(result.contact.phone ?? ''); // offer the scanned phone to confirm/edit
    setState('ready');
  }

  async function save(): Promise<void> {
    if (!contact?.name) return;
    const trimmed = phone.trim();
    // Carry the scanned title/email through only when there's something to keep,
    // so a name-only card stays on the simple (name[, phone]) contract.
    const extras = contact.title || contact.email ? { title: contact.title ?? null, email: contact.email ?? null } : undefined;
    if (extras) await onCreateClient(contact.name, trimmed || undefined, extras);
    else if (trimmed) await onCreateClient(contact.name, trimmed);
    else await onCreateClient(contact.name);
    setState('saved');
    hapticTick(); // a contact was created — a genuine commit
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
      {state === 'locked' && <div style={{ marginTop: '0.75rem' }}><Locked onSubscribe={() => onSubscribe?.()} /></div>}
      {state === 'error' && <p role="alert" style={{ color: 'var(--claret)' }}>Couldn't read that image — try again.</p>}
      {state === 'not_card' && <p role="alert">That doesn't look like a business card.</p>}
      {state === 'saved' && <p style={{ color: 'var(--green)' }}>Contact created.</p>}

      {state === 'ready' && contact && (
        <div data-testid="card-preview" className="tov-card tov-deal" style={{ margin: '0.75rem 0' }}>
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
