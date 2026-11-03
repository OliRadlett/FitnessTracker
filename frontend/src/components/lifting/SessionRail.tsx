'use client';

import React, { useMemo } from 'react';
import { ChevronRight, Flame } from 'lucide-react';
import type { LiftingSession, PersonalRecord } from '@/lib/api';
import { focusOf } from '@/lib/lifting/overview';
import { useSessionBrowserFilters } from './useSessionBrowserFilters';

type FilterBag = ReturnType<typeof useSessionBrowserFilters>;

const shortDate = (iso: string) => {
  const d = new Date(`${iso}T12:00:00`);
  return {
    weekday: d.toLocaleDateString('en-GB', { weekday: 'short' }),
    day: d.getDate(),
    month: d.toLocaleDateString('en-GB', { month: 'short' }),
    monthYear: d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),
  };
};

const weight = (n: number | null | undefined) => {
  if (n == null) return '—';
  return n >= 10_000 ? `${(n / 1000).toFixed(1)}t` : `${n.toLocaleString('en-GB')} kg`;
};

/**
 * Compact, month-grouped session rail. Replaces the 190px session-card grid.
 * The visible window is the full sessions query (≤200); the rail keeps its own
 * filter bag so `s_*` deep links continue to work.
 */
export function SessionRail({
  sessions,
  selectedId,
  onSelect,
  prsBySession,
  filterBag,
}: {
  sessions: LiftingSession[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  prsBySession: Map<string, PersonalRecord[]>;
  filterBag: FilterBag;
}) {
  const { filters, setPartial } = filterBag;
  const focus = filters.focus.trim();
  const q = filters.q.trim().toLowerCase();

  const focusOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of sessions) {
      const f = focusOf(s);
      counts.set(f, (counts.get(f) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [sessions]);

  const visible = useMemo(
    () =>
      sessions.filter((s) => {
        if (focus && focusOf(s) !== focus) return false;
        if (filters.from && s.session_date < filters.from) return false;
        if (filters.to && s.session_date > filters.to) return false;
        if (!q) return true;
        const haystack = `${focusOf(s)} ${s.program_name ?? ''} ${s.notes ?? ''} ${s.session_date}`.toLowerCase();
        return haystack.includes(q);
      }),
    [sessions, focus, q, filters.from, filters.to],
  );

  const groups = useMemo(() => {
    const out: { month: string; sessions: LiftingSession[] }[] = [];
    for (const s of visible) {
      const month = shortDate(s.session_date).monthYear;
      const last = out[out.length - 1];
      if (last?.month === month) last.sessions.push(s);
      else out.push({ month, sessions: [s] });
    }
    return out;
  }, [visible]);

  return (
    <div className="overflow-hidden rounded-xl border border-surface-light/60 bg-surface/50">
      <div className="flex items-center justify-between px-4 pb-2 pt-3.5">
        <h2 className="text-[15px] font-semibold">Sessions</h2>
        <span className="text-[12px] text-muted">{visible.length} sessions</span>
      </div>

      <div className="space-y-2 px-3 pb-3">
        <label className="relative block">
          <input
            value={filters.q}
            onChange={(e) => setPartial({ q: e.target.value })}
            placeholder="Search focus, notes, exercise…"
            aria-label="Search sessions"
            className="h-11 w-full rounded-lg border border-surface-light bg-surface pl-3 pr-3 text-[13px] text-foreground placeholder:text-muted/70 focus:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent/20"
          />
        </label>
        <div className="flex flex-wrap gap-1.5 pb-0.5">
          <button
            type="button"
            onClick={() => setPartial({ focus: '' })}
            className={`h-11 min-w-[44px] shrink-0 rounded-full border px-3 text-[12px] font-medium transition-colors ${
              focus === '' ? 'border-accent/50 bg-accent/10 text-accent' : 'border-surface-light/60 text-muted hover:text-foreground'
            }`}
          >
            All {sessions.length}
          </button>
          {focusOptions.map(([name, count]) => (
            <button
              key={name}
              type="button"
              onClick={() => setPartial({ focus: focus === name ? '' : name })}
              className={`h-11 min-w-[44px] shrink-0 rounded-full border px-3 text-[12px] font-medium transition-colors ${
                focus === name ? 'border-accent/50 bg-accent/10 text-accent' : 'border-surface-light/60 text-muted hover:text-foreground'
              }`}
            >
              {name} {count}
            </button>
          ))}
        </div>
      </div>

      <div className="border-t border-surface-light/40">
        {groups.map((group) => (
          <section key={group.month}>
            <p className="border-b border-surface-light/35 bg-surface/30 px-4 py-1.5 text-[12px] font-semibold uppercase tracking-[0.08em] text-muted">
              {group.month} <span className="ml-1 text-muted/70">{group.sessions.length}</span>
            </p>
            {group.sessions.map((s) => {
              const d = shortDate(s.session_date);
              const prs = prsBySession.get(s.id)?.length ?? 0;
              const selected = s.id === selectedId;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onSelect(s.id)}
                  aria-current={selected ? 'true' : undefined}
                  className={`grid w-full grid-cols-[52px_1fr_auto] items-center gap-2 border-b border-surface-light/35 px-3 py-2 text-left transition-colors last:border-b-0 ${
                    selected ? 'bg-surface-light/40' : 'hover:bg-surface-light/20'
                  }`}
                >
                  <span className={`flex flex-col items-center rounded-md py-0.5 ${selected ? 'bg-surface-light/60' : 'bg-surface-light/25'}`}>
                    <span className="text-[12px] font-semibold uppercase tracking-wide text-muted">{d.weekday}</span>
                    <span className="text-[16px] font-semibold leading-none">{d.day}</span>
                    <span className="text-[12px] uppercase tracking-wide text-muted">{d.month}</span>
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-[13px] font-medium">{focusOf(s)}</span>
                      {prs > 0 && (
                        <span className="inline-flex items-center gap-0.5 text-[12px] font-semibold text-positive">
                          <Flame className="h-3 w-3" aria-hidden />
                          {prs}
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block truncate text-[12px] text-muted">
                      {s.sets.length} sets · {s.estimated_tss ? `${Math.round(s.estimated_tss)} TSS` : '— TSS'}
                    </span>
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="text-right text-[12px] font-medium">{weight(s.total_volume_kg)}</span>
                    <ChevronRight className="h-3.5 w-3.5 text-muted/60" aria-hidden />
                  </span>
                </button>
              );
            })}
          </section>
        ))}
        {visible.length === 0 && <p className="px-4 py-8 text-center text-[12px] text-muted">No sessions match.</p>}
      </div>
    </div>
  );
}
