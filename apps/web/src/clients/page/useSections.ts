import { useEffect, useState } from 'react';
import { DEFAULT_OPEN, type ClientPageApi, type SectionKey } from './clientPageClient.js';

/** [P36-5] Which sections are open: the defaults until the rep's saved choice loads (from their account, so it
 *  follows them across devices); a toggle updates the screen at once and saves just that section. */
export function useSections(api: ClientPageApi): { open: Record<SectionKey, boolean>; toggle: (k: SectionKey) => void } {
  const [open, setOpen] = useState<Record<SectionKey, boolean>>(DEFAULT_OPEN);
  useEffect(() => {
    let live = true;
    void api.sections().then((saved) => { if (live) setOpen((cur) => ({ ...cur, ...saved })); });
    return () => { live = false; };
  }, [api]);
  const toggle = (k: SectionKey): void => {
    const value = !open[k];
    setOpen((cur) => ({ ...cur, [k]: value }));
    void api.saveSections({ [k]: value });
  };
  return { open, toggle };
}
