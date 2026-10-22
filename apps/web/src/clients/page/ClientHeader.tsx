import type { ReactNode } from 'react';
import type { LeadStatus } from '../clientsClient.js';
import { leadStatusLabel } from '../LeadStatus.js';
import { ago, type ClientOverview } from './clientPageClient.js';
import { Button } from '../../ui/Button.js';

/**
 * [P36-5] The client page's fixed header: the name, the status as a tappable control ("Warm ▾", or "Set status ▾"
 * when none is set — never "Unsorted"), one line ("Last message 3 days ago · 2 open promises"), the phone with
 * tap-to-call and tap-to-WhatsApp, and the one Add button for every capture.
 */
export function headerLine(o: ClientOverview | null, nowMs: number): string {
  if (!o) return '';
  const parts = [
    o.lastMessageAt ? `Last message ${ago(o.lastMessageAt, nowMs)}` : 'No messages yet',
    o.openPromises > 0 ? `${o.openPromises} open promise${o.openPromises === 1 ? '' : 's'}` : null,
  ];
  return parts.filter(Boolean).join(' · ');
}

/** wa.me wants the number in international form, digits only. */
export function whatsAppLink(phone: string): string | null {
  const digits = phone.replace(/[^\d]/g, '');
  return digits.length >= 7 ? `https://wa.me/${digits}` : null;
}

export function StatusButton({ status, onClick }: { status: LeadStatus | null | undefined; onClick: () => void }): JSX.Element {
  const label = status ? leadStatusLabel(status) : 'Set status';
  return (
    <button type="button" className={`lead-pill lead-pill--${status ?? 'unset'} tov-status-btn`} data-testid="status-button" onClick={onClick}
      aria-label={status ? `Status: ${label}. Change status` : 'Set status'} aria-haspopup="dialog">
      {label} <span aria-hidden="true">▾</span>
    </button>
  );
}

export function ClientHeader({ name, status, line, phone, phoneEditor, onStatus, addOpen, onAdd, children }: {
  name: string;
  status: LeadStatus | null | undefined;
  line: string;
  phone: string | null;
  /** The phone add/edit control (kept from the old page). */
  phoneEditor: ReactNode;
  onStatus: () => void;
  addOpen: boolean;
  onAdd: () => void;
  /** The capture options / active capture control, under the header. */
  children?: ReactNode;
}): JSX.Element {
  const wa = phone ? whatsAppLink(phone) : null;
  return (
    <header className="tov-clienthead" data-testid="client-header">
      {/* [P39-8] The name is the page title (PageHeader); the status sits first in the header block. */}
      <div className="tov-clienthead__row" aria-label={`${name}: status`}>
        <StatusButton status={status} onClick={onStatus} />
      </div>
      {line && <p className="tov-clienthead__line" data-testid="client-line">{line}</p>}
      <div className="tov-clienthead__contact">
        {phone && <a className="tov-chip-link" href={`tel:${phone.replace(/[^\d+]/g, '')}`}>Call</a>}
        {wa && <a className="tov-chip-link" href={wa} target="_blank" rel="noopener noreferrer">WhatsApp</a>}
        {phoneEditor}
      </div>
      <div><Button variant="primary" className="tov-clienthead__add" aria-haspopup="dialog" aria-expanded={addOpen} onClick={onAdd}>+ Add</Button></div>
      {children}
    </header>
  );
}
