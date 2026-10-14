'use client';

/**
 * UnplannedStrip — actuals that matched no plan day (`GET /{id}/unplanned`).
 *
 * Each entry can be attached to a day in the visible week via the targeted day
 * PATCH (`activity_id` / `lifting_session_id`), so an "extra" session stops
 * being invisible. Renders nothing when there is nothing unplanned.
 */

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import type { TrainingWeekDay } from '@/lib/api';
import { getUnplannedActuals, useAuthFetch } from '@/lib/api';
import { useInstantDayEdit } from '@/lib/training/useInstantDayEdit';

interface UnplannedItem {
  id: string;
  kind: 'activity' | 'lifting';
  label: string;
  date: string;
  detail: string;
}

export interface UnplannedStripProps {
  planId: string;
  week: number;
  /** Days of the visible week, for the "assign to" picker. */
  days: TrainingWeekDay[];
}

export function UnplannedStrip({ planId, week, days }: UnplannedStripProps) {
  const { authFetch, token } = useAuthFetch();
  const edit = useInstantDayEdit(planId, week);
  const [open, setOpen] = useState(false);
  const [targets, setTargets] = useState<Record<string, string>>({});

  const { data } = useQuery({
    queryKey: ['plan-unplanned', planId],
    queryFn: () => getUnplannedActuals(authFetch, planId, 14),
    enabled: !!token,
    staleTime: 60_000,
  });

  const items: UnplannedItem[] = [
    ...(data?.activities ?? []).map((a) => ({
      id: a.id,
      kind: 'activity' as const,
      label: a.name,
      date: a.start_date.slice(0, 10),
      detail: [
        a.distance_meters != null ? `${(a.distance_meters / 1000).toFixed(1)}km` : null,
        a.tss != null ? `${Math.round(a.tss)} TSS` : null,
      ]
        .filter(Boolean)
        .join(' · '),
    })),
    ...(data?.lifting_sessions ?? []).map((s) => ({
      id: s.id,
      kind: 'lifting' as const,
      label: s.focus ?? 'Lifting session',
      date: s.session_date,
      detail: s.total_volume_kg != null ? `${Math.round(s.total_volume_kg)}kg volume` : '',
    })),
  ];

  if (items.length === 0) return null;

  return (
    <div className="rounded-lg border border-warning/20 bg-warning/5 px-3 py-2 space-y-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 text-xs font-medium text-warning"
      >
        <span className="shrink-0">Unplanned</span>
        <span className="text-muted font-normal">
          {items.length} session{items.length === 1 ? '' : 's'} on no plan day
        </span>
        <span className="ml-auto text-muted">{open ? 'Hide' : 'Review'}</span>
      </button>

      {open && (
        <div className="space-y-1.5">
          {items.map((it) => (
            <div key={it.id} className="flex flex-wrap items-center gap-2 text-[11px]">
              <span className="text-foreground truncate max-w-[40%]">{it.label}</span>
              <span className="text-muted">
                {it.date}
                {it.detail ? ` · ${it.detail}` : ''}
              </span>
              <div className="flex items-center gap-1 ml-auto">
                <select
                  value={targets[it.id] ?? ''}
                  onChange={(e) => setTargets((t) => ({ ...t, [it.id]: e.target.value }))}
                  aria-label={`Assign ${it.label} to a day`}
                  className="px-1.5 py-1 bg-background border border-surface-light rounded text-foreground text-[11px]"
                >
                  <option value="">Assign to…</option>
                  {days.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.day_date.slice(0, 10)} — {d.sport}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => {
                    const dayId = targets[it.id];
                    if (!dayId) return;
                    edit.mutate({
                      dayId,
                      payload:
                        it.kind === 'activity'
                          ? { activity_id: it.id }
                          : { lifting_session_id: it.id },
                    });
                  }}
                  disabled={!targets[it.id] || edit.isPending}
                  className="px-2 py-1 bg-accent/20 text-accent rounded text-[11px] font-medium hover:bg-accent/30 disabled:opacity-40"
                >
                  Assign
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
