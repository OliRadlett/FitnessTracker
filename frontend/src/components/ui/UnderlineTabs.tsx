'use client';

import React, { useRef } from 'react';

export interface TabOption<T extends string> {
  value: T;
  label: string;
}

/**
 * Underline tab bar — the project's page-level section switch.
 *
 * One implementation for `/lifting` and `/cycling` (which is why it lives here
 * rather than in either page's folder): full-width rule under the tabs, the
 * active tab underlined in the accent colour, roving tabindex with
 * Arrow/Home/End, `aria-selected` per tab, and equal segments at 390 px.
 *
 * `SegmentedControl` remains the right choice for *filters* inside a panel
 * (Activities views, analytics range); this is the page's own section switch.
 */
export function UnderlineTabs<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: TabOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    let next = index;
    if (e.key === 'ArrowRight') next = (index + 1) % options.length;
    else if (e.key === 'ArrowLeft') next = (index - 1 + options.length) % options.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = options.length - 1;
    else return;
    e.preventDefault();
    refs.current[next]?.focus();
    onChange(options[next].value);
  };

  return (
    <div role="tablist" aria-label={ariaLabel} className="flex w-full items-stretch gap-1 border-b border-surface-light/60">
      {options.map((tab, i) => {
        const selected = tab.value === value;
        return (
          <button
            key={tab.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={`relative flex h-11 flex-1 items-center justify-center whitespace-nowrap text-[13px] font-medium transition-colors sm:flex-none sm:px-4 ${
              selected ? 'text-foreground' : 'text-muted hover:text-foreground'
            }`}
          >
            {tab.label}
            {selected && <span className="absolute inset-x-1 -bottom-px h-0.5 rounded-full bg-accent sm:inset-x-2" />}
          </button>
        );
      })}
    </div>
  );
}
