'use client';

import React, { useCallback, useRef } from 'react';
import type { LucideIcon } from 'lucide-react';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: LucideIcon;
}

// Shared segmented view-switch (1.5) — single tablist implementation with
// arrow-key navigation, replacing hand-rolled button rows.
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent, index: number) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const dir = e.key === 'ArrowRight' ? 1 : -1;
      const next = (index + dir + options.length) % options.length;
      refs.current[next]?.focus();
      onChange(options[next].value);
    },
    [onChange, options],
  );

  return (
    <div
      className="flex items-center bg-surface rounded-lg border border-surface-light overflow-x-auto max-w-full"
      role="tablist"
      aria-label={ariaLabel}
    >
      {options.map((opt, i) => {
        const Icon = opt.icon;
        const selected = value === opt.value;
        return (
          <button
            key={opt.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            onClick={() => onChange(opt.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            className={`min-h-[44px] px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap flex items-center gap-1.5 ${
              selected ? 'bg-accent text-white' : 'text-muted hover:text-foreground'
            }`}
          >
            {Icon && <Icon className="w-4 h-4" aria-hidden />}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
