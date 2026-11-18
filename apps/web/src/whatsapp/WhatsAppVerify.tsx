import { useEffect, useState } from 'react';
import { Button, TextInput } from '../ui/index.js';
import { displayPhone } from '../format/phone.js';
import { useWhatsApp } from './useWhatsApp.js';

/**
 * [P75 · owner] The one verify step, the P67 linking flow, used by the Today banner's sheet, Settings → WhatsApp and
 * the first sign-in step. The number is pre-filled from the access request (Change number to use another). Get my code
 * makes a one-time code (15 minutes, single use; a new one voids the old); Open WhatsApp types "LINK <code>" to Tovira.
 * A code that arrived from a different number asks the rep to confirm THAT number: only the number they sent from can
 * be linked, and only once they say yes.
 */
export function WhatsAppVerify({ startEditing = false }: { startEditing?: boolean }): JSX.Element | null {
  const wa = useWhatsApp();
  const s = wa.status;
  const known = s?.requestedNumber ?? s?.linked?.phone ?? '';
  const [editing, setEditing] = useState(startEditing || !known);
  const [phone, setPhone] = useState(displayPhone(known));
  useEffect(() => { if (!editing) setPhone(displayPhone(known)); }, [known, editing]);
  if (!s) return null;

  if (s.awaitingConfirm) {
    const came = displayPhone(s.awaitingConfirm.phone);
    const meant = wa.pending?.phone ?? s.requestedNumber ?? s.linked?.phone ?? null;
    return (
      <div className="ui-stack ui-gap-3" data-testid="whatsapp-confirm">
        <p style={{ margin: 0 }}>Your code came from <Num>{came}</Num>{meant ? <>, not <Num>{displayPhone(meant)}</Num></> : ''}. Use <Num>{came}</Num> for Tovira?</p>
        <div className="ui-cluster ui-gap-2">
          <Button variant="primary" onClick={() => void wa.confirm(true)}>Yes, use {came}</Button>
          <Button onClick={() => void wa.confirm(false)}>No</Button>
        </div>
        {wa.error && <p role="alert" className="ui-danger" style={{ margin: 0 }}>{wa.error}</p>}
      </div>
    );
  }

  if (wa.pending) {
    const p = wa.pending;
    return (
      <div className="ui-stack ui-gap-3" data-testid="whatsapp-pending">
        <p style={{ margin: 0 }}>
          Your code is <strong data-testid="whatsapp-code">{p.code}</strong>. Tap Open WhatsApp: it types “LINK {p.code}” to Tovira. Send it from <Num>{displayPhone(p.phone)}</Num>. The code works once, for 15 minutes.
        </p>
        <div className="ui-cluster ui-gap-2">
          <a className="ui-btn ui-btn--primary" href={p.waLink} target="_blank" rel="noreferrer">Open WhatsApp</a>
          <Button onClick={() => { wa.reset(); setEditing(true); }}>Change number</Button>
        </div>
        <p className="ui-caption" style={{ margin: 0 }} aria-live="polite">Waiting for your message…</p>
      </div>
    );
  }

  return (
    <div className="ui-stack ui-gap-3" data-testid="whatsapp-verify">
      {editing ? (
        <TextInput label="WhatsApp number" type="tel" inputMode="tel" autoComplete="tel" placeholder="With the country code" value={phone} onChange={(e) => setPhone(e.target.value)} />
      ) : (
        <div className="ui-cluster ui-cluster--between ui-gap-2">
          <span>Your WhatsApp number: <strong className="wa-num">{displayPhone(known)}</strong></span>
          <Button size="sm" onClick={() => setEditing(true)}>Change number</Button>
        </div>
      )}
      {wa.error && <p role="alert" className="ui-danger" style={{ margin: 0 }}>{wa.error}</p>}
      <div><Button variant="primary" loading={wa.busy} disabled={!phone.trim()} onClick={() => void wa.start(editing ? phone : known)}>Get my code</Button></div>
    </div>
  );
}

/** A phone number never breaks across lines. */
function Num({ children }: { children: string }): JSX.Element { return <span className="wa-num">{children}</span>; }
