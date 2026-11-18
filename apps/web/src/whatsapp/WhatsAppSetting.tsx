import { useEffect, useState } from 'react';
import { Button, Section } from '../ui/index.js';
import { displayPhone } from '../format/phone.js';
import { toviraVCard } from './whatsappClient.js';
import { useWhatsApp, verifiedDate } from './useWhatsApp.js';
import { WhatsAppVerify } from './WhatsAppVerify.js';

/**
 * [P67 → P75 · owner] Settings › WhatsApp: the status (Not verified / Verified on <date>), the number, Verify now and
 * Change number. Verifying is the P67 flow (a code sent FROM the number proves it is the rep's; no SMS), the number
 * pre-filled from the access request. Once verified: Tovira's number to send exported chats to, Save Tovira's number,
 * Change number and Unlink. Switched off for the rep (the server answers 404): the whole section is absent.
 */
export function WhatsAppSetting(): JSX.Element | null {
  const wa = useWhatsApp();
  const [panel, setPanel] = useState<null | 'verify' | 'change'>(null);
  const s = wa.status;
  const verifiedAt = s?.linked?.linkedAt ?? null;
  useEffect(() => { if (verifiedAt) setPanel(null); }, [verifiedAt]); // just verified: back to the status
  if (!s) return null; // switched off, or not loaded yet: nothing is shown

  const number = s.linked?.phone ?? s.requestedNumber;
  const showPanel = !!s.awaitingConfirm || !!wa.pending || panel !== null;
  const vcard = `data:text/vcard;charset=utf-8,${encodeURIComponent(toviraVCard(s.businessNumber))}`;
  const open = (p: 'verify' | 'change'): void => { wa.reset(); setPanel(p); };

  return (
    <Section title="WhatsApp" testId="whatsapp-setting">
      <div className="ui-stack ui-gap-3">
        <dl className="wa-status">
          <div><dt>Status</dt><dd data-testid="whatsapp-status">{s.linked ? `Verified on ${verifiedDate(s.linked.linkedAt)}` : 'Not verified'}</dd></div>
          <div><dt>Number</dt><dd data-testid="whatsapp-number">{number ? displayPhone(number) : 'Not added yet'}</dd></div>
        </dl>
        {s.linked && (
          <p style={{ margin: 0 }} data-testid="whatsapp-linked">Send any exported chat to Tovira on WhatsApp: <strong>{displayPhone(s.businessNumber)}</strong></p>
        )}
        <div className="ui-cluster ui-gap-2">
          {!s.linked && <Button variant="primary" onClick={() => open('verify')}>Verify now</Button>}
          {s.linked && <a className="ui-btn ui-btn--secondary" href={vcard} download="Tovira.vcf">Save Tovira’s number</a>}
          {!showPanel && <Button onClick={() => open('change')}>Change number</Button>}
          {s.linked && <Button onClick={() => { setPanel(null); void wa.unlink(); }}>Unlink</Button>}
        </div>
        {showPanel && <WhatsAppVerify key={panel ?? 'auto'} startEditing={panel === 'change'} />}
      </div>
    </Section>
  );
}
