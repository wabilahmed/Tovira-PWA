import { useEffect, useRef, useState } from 'react';
import { Button, Section, TextInput } from '../ui/index.js';
import { displayPhone } from '../format/phone.js';
import { toviraVCard, type WhatsAppApi, type WhatsAppStatus } from './whatsappClient.js';

/**
 * [P67 · owner] Settings › Send chats on WhatsApp. The rep enters their WhatsApp number, gets a one-time code and a
 * button that opens WhatsApp with "LINK 482193" typed to Tovira's number; sending it from that number proves it is
 * theirs (no SMS). Once linked: Tovira's number to send exported chats to, Save Tovira's number, and Unlink.
 * Switched off (the server answers 404), the whole section is absent.
 */
export function WhatsAppSetting({ api, pollMs = 4000, onChange }: { api: WhatsAppApi; pollMs?: number; /** linked or unlinked */ onChange?: (s: WhatsAppStatus) => void }): JSX.Element | null {
  const [status, setStatusState] = useState<WhatsAppStatus | null | undefined>(undefined);
  const setStatus = (s: WhatsAppStatus | null | undefined): void => { setStatusState(s); if (s) onChange?.(s); };
  const [phone, setPhone] = useState('');
  const [pending, setPending] = useState<{ code: string; waLink: string; expiresAt: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);

  useEffect(() => { alive.current = true; void api.status().then((s) => { if (alive.current) setStatus(s); }); return () => { alive.current = false; }; }, [api]);

  // While a code is out, check every few seconds whether WhatsApp delivered it (until it expires).
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => {
      if (Date.now() > pending.expiresAt) { setPending(null); setError('That code expired. Get a new one.'); return; }
      void api.status().then((s) => { if (alive.current && s?.linked) { setStatus(s); setPending(null); } });
    }, pollMs);
    return () => clearInterval(t);
  }, [pending, api, pollMs]);

  if (!status) return null; // switched off, or not loaded yet: nothing is shown

  async function getCode(): Promise<void> {
    setError(null); setBusy(true);
    const r = await api.startLink(phone);
    setBusy(false);
    if (!r.ok) { setError(r.message); return; }
    setPending({ code: r.code, waLink: r.waLink, expiresAt: r.expiresAt });
  }
  async function unlink(): Promise<void> {
    const s = await api.unlink();
    if (s) setStatus(s);
  }
  const vcard = `data:text/vcard;charset=utf-8,${encodeURIComponent(toviraVCard(status.businessNumber))}`;

  return (
    <Section title="Send chats on WhatsApp" testId="whatsapp-setting">
      {status.linked ? (
        <div className="ui-stack ui-gap-3" data-testid="whatsapp-linked">
          <p style={{ margin: 0 }}>
            Linked: {displayPhone(status.linked.phone)}. Send any exported chat to Tovira on WhatsApp: <strong>{displayPhone(status.businessNumber)}</strong>
          </p>
          <div className="ui-cluster ui-gap-2">
            <a className="ui-btn ui-btn--secondary" href={vcard} download="Tovira.vcf">Save Tovira’s number</a>
            <Button onClick={() => void unlink()}>Unlink</Button>
          </div>
        </div>
      ) : pending ? (
        <div className="ui-stack ui-gap-3" data-testid="whatsapp-pending">
          <p style={{ margin: 0 }}>Your code is <strong>{pending.code}</strong>. Tap below to open WhatsApp with “LINK {pending.code}” typed to Tovira, then send it. The code works once, for 15 minutes.</p>
          <div className="ui-cluster ui-gap-2">
            <a className="ui-btn ui-btn--primary" href={pending.waLink} target="_blank" rel="noreferrer">Open WhatsApp</a>
            <Button onClick={() => setPending(null)}>Cancel</Button>
          </div>
          <p className="ui-caption" style={{ margin: 0 }}>Waiting for your message…</p>
        </div>
      ) : (
        <div className="ui-stack ui-gap-3" data-testid="whatsapp-start">
          <p style={{ margin: 0 }}>Send an exported chat to Tovira’s WhatsApp number instead of choosing the file here. Link your number first.</p>
          <TextInput label="Your WhatsApp number" type="tel" inputMode="tel" autoComplete="tel" placeholder="+971 50 123 4567" value={phone} onChange={(e) => setPhone(e.target.value)} />
          {error && <p role="alert" style={{ margin: 0, color: 'var(--color-danger)' }}>{error}</p>}
          <div><Button variant="primary" loading={busy} disabled={!phone.trim()} onClick={() => void getCode()}>Get a code</Button></div>
        </div>
      )}
    </Section>
  );
}
