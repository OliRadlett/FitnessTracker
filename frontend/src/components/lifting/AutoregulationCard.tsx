'use client';

// Feature 6 / B-17 — strength autoregulation hints. Last working (non-warmup)
// set per exercise → RPE-ruled load suggestion. Read-only; Live Lift stays
// pure logging.

import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthFetch } from '@/lib/api';
import type { LiftingSession } from '@/lib/api';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { autoregulate, type Autoregulation, type ExerciseState } from '@/lib/prescription';

export function lastWorkingSets(sessions: LiftingSession[]): ExerciseState[] {
  const seen = new Map<string, ExerciseState>();
  const ordered = [...sessions].sort(
    (a, b) => +new Date(b.session_date) - +new Date(a.session_date),
  );
  for (const s of ordered) {
    for (const set of s.sets ?? []) {
      if (set.is_warmup) continue;
      if (!seen.has(set.exercise_name) && set.weight_kg != null) {
        seen.set(set.exercise_name, {
          name: set.exercise_name,
          lastWeightKg: set.weight_kg,
          lastReps: set.reps,
          lastRpe: set.rpe ?? null,
        });
      }
    }
    if (seen.size >= 6) break;
  }
  return [...seen.values()];
}

/** Shared map for plan views: exercise name → suggestion (cached query). */
export function useAutoregulationMap(): Map<string, Autoregulation> {
  const { authFetch, token } = useAuthFetch();
  const { data: sessions } = useQuery<LiftingSession[]>({
    queryKey: ['lifting-sessions'],
    queryFn: () => authFetch<LiftingSession[]>('/api/v1/lifting/sessions'),
    staleTime: 60_000,
    enabled: !!token,
  });
  return useMemo(() => {
    const map = new Map<string, Autoregulation>();
    for (const ex of lastWorkingSets(sessions ?? [])) {
      map.set(ex.name.toLowerCase(), autoregulate(ex));
    }
    return map;
  }, [sessions]);
}

export function AutoregulationCard({ sessions }: { sessions: LiftingSession[] | undefined }) {
  const hints = useMemo(
    () => (sessions ? lastWorkingSets(sessions).map(autoregulate) : []),
    [sessions],
  );
  if (hints.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>🎛️ Suggested Working Weights</CardTitle>
      </CardHeader>
      <p className="text-xs text-muted mb-3">
        From your last logged RPE per exercise — easy (≤7) adds 2.5 kg, grinders (≥9) drop 2.5 kg.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {hints.map((h) => (
          <div key={h.name} className="p-3 bg-surface-light/30 rounded-lg">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-sm font-medium text-foreground truncate">{h.name}</p>
              <p className={`text-sm font-mono font-bold shrink-0 ${
                h.deltaKg > 0 ? 'text-positive' : h.deltaKg < 0 ? 'text-warning' : 'text-muted'
              }`}>
                {h.suggestedWeightKg != null ? `${h.suggestedWeightKg}kg` : '—'}
                {h.deltaKg !== 0 && (
                  <span className="text-xs ml-1">({h.deltaKg > 0 ? '+' : ''}{h.deltaKg})</span>
                )}
              </p>
            </div>
            <p className="text-xs text-muted mt-0.5">{h.reason}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}
