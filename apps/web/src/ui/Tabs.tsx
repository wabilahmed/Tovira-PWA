import { useId, useRef, type ReactNode } from 'react';

/** [P39] Segmented tabs (e.g. iPhone | Android). Arrow keys move between tabs. */
export function Tabs<T extends string>({ label, tabs, value, onChange, children }: {
  label: string;
  tabs: Array<{ value: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
  children: ReactNode;
}): JSX.Element {
  const id = useId();
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  function onKey(e: React.KeyboardEvent): void {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const i = tabs.findIndex((t) => t.value === value);
    const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]!;
    onChange(next.value);
    refs.current[next.value]?.focus();
  }
  return (
    <div className="ui-stack ui-gap-3">
      <div className="ui-tabs" role="tablist" aria-label={label} onKeyDown={onKey}>
        {tabs.map((t) => (
          <button key={t.value} ref={(el) => { refs.current[t.value] = el; }} type="button" role="tab" id={`${id}-${t.value}`} className="ui-tab"
            aria-selected={t.value === value} aria-controls={`${id}-panel`} tabIndex={t.value === value ? 0 : -1} onClick={() => onChange(t.value)}>
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${value}`}>{children}</div>
    </div>
  );
}
