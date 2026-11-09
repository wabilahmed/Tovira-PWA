import { createContext, useContext } from 'react';

/**
 * [P67 · owner] Tovira's WhatsApp number, but ONLY for a rep whose own number is linked (and only while the feature is
 * on); null otherwise. The export steps read it to add "Or send the export to Tovira on WhatsApp"; Settings updates it
 * when the rep links or unlinks.
 */
export interface LinkedWhatsApp { number: string | null; set: (n: string | null) => void }
export const LinkedWhatsAppContext = createContext<LinkedWhatsApp>({ number: null, set: () => undefined });
export function useLinkedWhatsApp(): string | null { return useContext(LinkedWhatsAppContext).number; }
export function useSetLinkedWhatsApp(): (n: string | null) => void { return useContext(LinkedWhatsAppContext).set; }
