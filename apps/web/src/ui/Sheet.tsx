import type { ReactNode } from 'react';
import { BottomSheet } from '../shell/BottomSheet.js';

/** [P39] The bottom sheet (the shell's draggable sheet) with a titled, padded body. */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }): JSX.Element {
  return (
    <BottomSheet open={open} onClose={onClose} label={title} portal>
      {open && (
        <div className="ui-sheet">
          <h2 className="ui-sheet__title">{title}</h2>
          {children}
        </div>
      )}
    </BottomSheet>
  );
}
