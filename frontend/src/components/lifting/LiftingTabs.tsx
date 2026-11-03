'use client';

import React, { useRef } from 'react';

export type LiftingTab = 'overview' | 'sessions' | 'analytics' | 'prs';

const TABS: { value: LiftingTab; label: string }[] = [
  { value: 'overview', label: 'Overview' },
  { value: 'sessions', label: 'Sessions' },
  { value: 'analytics', label: 'Analytics' },
  { value: 'prs', label: 'PRs' },
];

/**
 * Underline tab bar for the lifting page. Roving tabindex + arrow/Home/End keys,
 * and each button owns its own aria-selected. Four equal segments at 390px.
 */
export function LiftingTabs({
  value,
  onChange,
}: {
  value: LiftingTab;
  onChange: (tab: LiftingTab) => void;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    let next = index;
    if (e.key === 'ArrowRight') next = (index + 1) % TABS.length;
    else if (e.key === 'ArrowLeft') next = (index - 1 + TABS.length) % TABS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = TABS.length - 1;
    else return;
    e.preventDefault();
    refs.current[next]?.focus();
    onChange(TABS[next].value);
  };

  return (
    <div
      role="tablist"
      aria-label="Lifting sections"
      className="flex w-full items-stretch gap-1 border-b border-surface-light/60"
    >
      {TABS.map((tab, i) => {
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
