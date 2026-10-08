'use client';

import React, { useMemo } from 'react';

export interface SessionFocusChipsProps {
  /** Currently selected focus value; null = "All". Feeds the session browser filter state. */
  value: string | null;
  onChange: (focus: string | null) => void;
  /** Sessions to derive focus options from (only `focus` is read). */
  sessions?: Array<{ focus?: string | null }>;
  /** Explicit options override when the caller already computed them. */
  options?: string[];
  /** Optional per-focus session counts, rendered inside each chip. */
  counts?: Record<string, number>;
  /** Total session count for the "All" chip. */
  totalCount?: number;
  isLoading?: boolean;
}

function normaliseFocus(focus: string | null | undefined): string | null {
  const trimmed = (focus ?? '').trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Focus filter chips for the session browser (t4 enhancement batch).
 *
 * Presentational + derived-state only: the owning browser keeps the filter
 * state (`focusFilter: string | null`) and applies it alongside search /
 * pagination. Wiring: `<SessionFocusChips value={focusFilter}
 * onChange={setFocusFilter} sessions={sessions} />`.
 */
export function SessionFocusChips({
  value,
  onChange,
  sessions,
  options,
  counts,
  totalCount,
  isLoading,
}: SessionFocusChipsProps) {
  const derived = useMemo(() => {
    if (options) return options.filter((o) => o.trim() !== '');
    if (!sessions) return [];
    const seen = new Map<string, string>();
    for (const s of sessions) {
      const n = normaliseFocus(s.focus);
      if (n && !seen.has(n.toLowerCase())) seen.set(n.toLowerCase(), n);
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  }, [options, sessions]);

  const derivedCounts = useMemo(() => {
    if (counts || !sessions) return counts;
    const map: Record<string, number> = {};
    for (const s of sessions) {
      const n = normaliseFocus(s.focus);
      if (n) map[n] = (map[n] ?? 0) + 1;
    }
    return map;
  }, [counts, sessions]);

  if (isLoading) {
    return (
      <div
        className="flex gap-2 overflow-hidden py-1"
        role="status"
        aria-label="Loading focus filters"
      >
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-9 w-24 shrink-0 animate-pulse rounded-full bg-surface-light/50 motion-reduce:animate-none"
          />
        ))}
      </div>
    );
  }

  if (derived.length === 0) return null;

  const chipBase =
    'min-h-[44px] inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm transition-colors motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-accent';
  const active = 'border-accent/60 bg-accent/15 text-foreground';
  const inactive =
    'border-surface-light/50 bg-surface text-muted hover:border-surface-light hover:text-foreground';

  return (
    <div
      className="flex gap-2 overflow-x-auto py-1"
      role="group"
      aria-label="Filter sessions by focus"
    >
      <button
        type="button"
        onClick={() => onChange(null)}
        aria-pressed={value == null}
        className={`${chipBase} ${value == null ? active : inactive}`}
      >
        All
        {totalCount != null && (
          <span className="text-xs text-muted" aria-hidden="true">
            {totalCount}
          </span>
        )}
      </button>
      {derived.map((focus) => {
        const selected = value != null && value.toLowerCase() === focus.toLowerCase();
        const count = derivedCounts?.[focus];
        return (
          <button
            key={focus}
            type="button"
            onClick={() => onChange(selected ? null : focus)}
            aria-pressed={selected}
            title={selected ? `Clear ${focus} filter` : `Show ${focus} sessions`}
            className={`${chipBase} ${selected ? active : inactive}`}
          >
            {focus}
            {count != null && (
              <span className="text-xs text-muted" aria-hidden="true">
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
