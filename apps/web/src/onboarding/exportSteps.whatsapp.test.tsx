import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ExportSteps } from './exportSteps.js';
import { LinkedWhatsAppContext } from '../whatsapp/linkedNumber.js';

/** [P67 · owner] The export steps gain "Or send the export to Tovira on WhatsApp", only for a rep with a linked number. */
const nav = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' };
describe('<ExportSteps> and Tovira on WhatsApp', () => {
  it('a rep with a linked number (feature on) sees the WhatsApp option with Tovira\'s number', () => {
    render(<LinkedWhatsAppContext.Provider value={{ number: '+971500000001', set: () => undefined }}><ExportSteps nav={nav} standalone={false} install={null} /></LinkedWhatsAppContext.Provider>);
    expect(screen.getByTestId('export-whatsapp')).toHaveTextContent('Or send the export to Tovira on WhatsApp: when it asks where to send it, choose WhatsApp, then Tovira (+971 50 000 0001).');
  });
  it('no linked number, or switched off: the steps are unchanged', () => {
    render(<ExportSteps nav={nav} standalone={false} install={null} />);
    expect(screen.queryByTestId('export-whatsapp')).toBeNull();
    expect(screen.queryByText(/whatsapp:/i)).toBeNull();
  });
});
