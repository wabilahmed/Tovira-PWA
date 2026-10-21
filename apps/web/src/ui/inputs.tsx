import { useId, useState, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { Sheet } from './Sheet.js';

/** [P39] A labelled text input (44px). */
export function TextInput({ label, hideLabel = false, ...rest }: { label: string; hideLabel?: boolean } & InputHTMLAttributes<HTMLInputElement>): JSX.Element {
  const id = useId();
  return (
    <div className="ui-field">
      <label htmlFor={id} className={hideLabel ? 'sr-only' : 'ui-field__label'}>{label}</label>
      <input id={id} className="ui-input" {...rest} />
    </div>
  );
}

export function TextArea({ label, hideLabel = false, ...rest }: { label: string; hideLabel?: boolean } & TextareaHTMLAttributes<HTMLTextAreaElement>): JSX.Element {
  const id = useId();
  return (
    <div className="ui-field">
      <label htmlFor={id} className={hideLabel ? 'sr-only' : 'ui-field__label'}>{label}</label>
      <textarea id={id} className="ui-input" {...rest} />
    </div>
  );
}

/** [P39] Search: a magnifier, the input, a clear button when there's text. */
export function SearchInput({ label, value, onChange, placeholder, trailing }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; trailing?: ReactNode }): JSX.Element {
  return (
    <div className="ui-cluster ui-cluster--nowrap ui-gap-2">
      <div className="ui-search">
        <span className="ui-search__icon" aria-hidden="true">⌕</span>
        <input type="search" className="ui-input" aria-label={label} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
        {value && <button type="button" className="ui-iconbtn ui-search__clear" aria-label="Clear search" data-testid="search-clear" onClick={() => onChange('')}>×</button>}
      </div>
      {trailing}
    </div>
  );
}

/** [P39] A styled select — never the browser default: a button that opens a Sheet of options. */
export function Select<T extends string>({ label, value, options, onChange, hideLabel = false }: { label: string; value: T; options: Array<{ value: T; label: string; hint?: string }>; onChange: (v: T) => void; hideLabel?: boolean }): JSX.Element {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  return (
    <div className="ui-field">
      {!hideLabel && <span className="ui-field__label">{label}</span>}
      <button type="button" className="ui-btn ui-btn--secondary ui-select" aria-haspopup="dialog" aria-label={`${label}: ${current?.label ?? ''}`} onClick={() => setOpen(true)}>
        <span>{current?.label}</span><span className="ui-select__chev" aria-hidden="true">▾</span>
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={label}>
        <div role="radiogroup" aria-label={label} className="ui-stack ui-gap-1">
          {options.map((o) => (
            <button key={o.value} type="button" role="radio" aria-checked={o.value === value} className="ui-sheet__option" onClick={() => { onChange(o.value); setOpen(false); }}>
              <span>{o.label}{o.value === value ? ' ✓' : ''}</span>
              {o.hint && <span className="ui-sheet__hint">{o.hint}</span>}
            </button>
          ))}
        </div>
      </Sheet>
    </div>
  );
}

/** [P39] A styled file picker — never "Choose file / No file chosen": a real button, then the chosen name + size. */
export function FileButton({ label, accept, multiple = false, onFiles, chosen }: { label: string; accept?: string; multiple?: boolean; onFiles: (files: FileList | null) => void; chosen?: Array<{ name: string; size: number }> }): JSX.Element {
  return (
    <div className="ui-file">
      <span className="ui-btn ui-btn--secondary ui-btn--block" aria-hidden="true">{label}</span>
      <input type="file" className="ui-file__input" aria-label={label} accept={accept} multiple={multiple} onChange={(e) => onFiles(e.target.files)} />
      {chosen && chosen.length > 0 && (
        <span className="ui-file__chosen" data-testid="file-chosen">{chosen.map((f) => `${f.name} · ${formatSize(f.size)}`).join(', ')}</span>
      )}
    </div>
  );
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
