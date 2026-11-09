import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WhatsAppSetting } from './WhatsAppSetting.js';
import { toviraVCard, type WhatsAppApi, type WhatsAppStatus } from './whatsappClient.js';

/** [P67 · owner] Settings › Send chats on WhatsApp: link with a code sent from WhatsApp; linked shows Tovira's number. */
const OFF: WhatsAppApi = { status: async () => null, startLink: async () => ({ ok: false, message: 'x' }), unlink: async () => null };
const unlinked: WhatsAppStatus = { linked: null, businessNumber: '+971500000001' };
const linked: WhatsAppStatus = { linked: { phone: '+971501234567', linkedAt: 1 }, businessNumber: '+971500000001' };

describe('<WhatsAppSetting>', () => {
  it('switched off: nothing is shown at all', async () => {
    const { container } = render(<WhatsAppSetting api={OFF} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText(/whatsapp/i)).toBeNull();
  });

  it('linking: enter the number, get the code and the button that opens WhatsApp with LINK <code>; linked once it arrives', async () => {
    let s = unlinked;
    const api: WhatsAppApi = {
      status: vi.fn(async () => s),
      startLink: vi.fn(async () => ({ ok: true as const, code: '482193', phone: '+971501234567', waLink: 'https://wa.me/971500000001?text=LINK%20482193', expiresAt: Date.now() + 900_000 })),
      unlink: async () => unlinked,
    };
    render(<WhatsAppSetting api={api} pollMs={10} />);
    await userEvent.type(await screen.findByLabelText('Your WhatsApp number'), '+971 50 123 4567');
    await userEvent.click(screen.getByRole('button', { name: 'Get a code' }));
    expect(api.startLink).toHaveBeenCalledWith('+971 50 123 4567');
    expect(screen.getByTestId('whatsapp-pending')).toHaveTextContent('Your code is 482193.');
    expect(screen.getByRole('link', { name: 'Open WhatsApp' })).toHaveAttribute('href', 'https://wa.me/971500000001?text=LINK%20482193');
    s = linked; // the message arrived from that number
    await waitFor(() => expect(screen.getByTestId('whatsapp-linked')).toBeInTheDocument());
  });

  it('linked: Tovira\'s number in international format, Save Tovira\'s number (vCard), and Unlink', async () => {
    const api: WhatsAppApi = { status: async () => linked, startLink: async () => ({ ok: false, message: '' }), unlink: vi.fn(async () => unlinked) };
    render(<WhatsAppSetting api={api} />);
    const box = await screen.findByTestId('whatsapp-linked');
    expect(box).toHaveTextContent('Linked: +971 50 123 4567. Send any exported chat to Tovira on WhatsApp: +971 50 000 0001');
    const save = screen.getByRole('link', { name: 'Save Tovira’s number' });
    expect(save).toHaveAttribute('download', 'Tovira.vcf');
    expect(decodeURIComponent(save.getAttribute('href')!.split(',')[1]!)).toBe(toviraVCard('+971500000001'));
    await userEvent.click(screen.getByRole('button', { name: 'Unlink' }));
    expect(api.unlink).toHaveBeenCalled();
    expect(await screen.findByTestId('whatsapp-start')).toBeInTheDocument();
  });

  it('a refused number shows the server\'s reason', async () => {
    const api: WhatsAppApi = { status: async () => unlinked, startLink: async () => ({ ok: false, message: 'This number is linked to another Tovira account.' }), unlink: async () => unlinked };
    render(<WhatsAppSetting api={api} />);
    await userEvent.type(await screen.findByLabelText('Your WhatsApp number'), '+971501234567');
    await userEvent.click(screen.getByRole('button', { name: 'Get a code' }));
    expect(screen.getByRole('alert')).toHaveTextContent('This number is linked to another Tovira account.');
  });
});
