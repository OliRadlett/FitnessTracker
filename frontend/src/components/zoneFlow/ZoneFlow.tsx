'use client';

/**
 * ZoneFlow — the "I have 1 hour, Z2" on-demand flow (ui-redesign-v2 §4.3).
 *
 * Steps: (1) zone chips Z1–Z5 + duration chips 30m–3h → (2) up to three
 * matching routes (distance, est TSS, weather badge each) → (3) route preview
 * on mini-map with fuel estimate (per-row expansion) → (4) [Plan workout] /
 * [Push to Wahoo] per route.
 *
 * On-demand only: nothing fires until the user taps "Find matching routes"
 * (verdict philosophy — no unsolicited suggestions). The matcher endpoint and
 * zone list are the existing workout-planner APIs (import-only reuse of the
 * buried matcher implementation in `training/WorkoutPlanner` — same paths,
 * same payload shape, same `['workout-zones']` cache entry, no edits there).
 *
 * Differences from WorkoutPlanner (deliberate): readiness is shown as context
 * but never disables a zone (the user explicitly asked for that intensity);
 * results are capped at 3 (the moment spec); empty is the Honest Empty
 * (what + how + CTA), never a bare "no routes" line.
 *
 * Plan context props mirror WorkoutPlanner's (`planId`/`planDays`) plus an
 * optional pre-selected `pushDay` so the TODAY flow can offer one-tap Wahoo
 * push; without them the rows degrade to an honest "open from a plan day"
 * note. Intended mount: TODAY flow (wiring happens in a later wave — this
 * component is deliberately not referenced from any existing file).
 */

import React, { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useAuthFetch } from '@/lib/api';
import type {
  RouteMatchResponse,
  TrainingPlanDay,
  TrainingWeekDay,
  WorkoutZonesResponse,
} from '@/lib/api';
import { Card } from '@/components/ui/Card';
import { ErrorState } from '@/components/ui/ErrorState';
import { ZoneFlowRouteRow } from './ZoneFlowRouteRow';
import {
  DURATION_OPTIONS,
  ZONE_FLOW_MAX_RESULTS,
  ZONE_OPTIONS,
  durationLabel,
  noMatchCopy,
  zoneLabel,
} from './zoneFlowUtils';

interface ZoneFlowProps {
  /** RM1-style write-back target (same shape as WorkoutPlanner). */
  planId?: string | null;
  planDays?: TrainingPlanDay[];
  /** Pre-selected cycle day for one-tap Wahoo push. */
  pushDay?: TrainingWeekDay | null;
}

export function ZoneFlow({ planId, planDays, pushDay }: ZoneFlowProps) {
  const { authFetch, token } = useAuthFetch();
  const [zone, setZone] = useState('z2');
  const [duration, setDuration] = useState(60);

  const {
    data: zonesData,
    isLoading: zonesLoading,
    isError: zonesIsError,
    error: zonesError,
    refetch: refetchZones,
  } = useQuery<WorkoutZonesResponse>({
    queryKey: ['workout-zones'],
    queryFn: () => authFetch<WorkoutZonesResponse>('/api/v1/workout-planner/zones'),
    enabled: !!token,
    staleTime: 300_000,
  });

  const matchMutation = useMutation({
    mutationFn: () =>
      authFetch<RouteMatchResponse>('/api/v1/workout-planner/match-routes', {
        method: 'POST',
        body: JSON.stringify({
          difficulty: zone,
          duration_minutes: duration,
          max_results: ZONE_FLOW_MAX_RESULTS,
        }),
      }),
  });

  const result = matchMutation.data ?? null;
  const plan = result?.workout_target ?? null;
  const matches = result?.matches ?? [];
  const searched = matchMutation.isSuccess || matchMutation.isError;

  if (zonesLoading) {
    return (
      <Card>
        <div className="animate-pulse space-y-3" aria-label="Loading workout zones">
          <div className="h-5 bg-surface-light rounded w-48" />
          <div className="flex gap-2">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="h-11 flex-1 bg-surface-light/40 rounded-lg" />
            ))}
          </div>
          <div className="h-11 bg-surface-light/40 rounded-lg w-56" />
        </div>
      </Card>
    );
  }

  if (zonesIsError) {
    return (
      <ErrorState
        title="Couldn't load workout zones"
        message={(zonesError as Error)?.message ?? 'Check your connection and try again.'}
        onRetry={() => refetchZones()}
      />
    );
  }

  if (!zonesData?.ftp_watts) {
    return (
      <Card className="border-yellow-500/30 bg-yellow-500/5">
        <p className="text-sm font-medium text-foreground mb-1">FTP needed for route matching</p>
        <p className="text-xs text-muted">
          Set your FTP on the{' '}
          <Link href="/cycling" className="underline hover:text-yellow-300 text-yellow-400">
            Cycling page
          </Link>{' '}
          and matching routes will appear here.
        </p>
      </Card>
    );
  }

  const empty = noMatchCopy(zone, duration);

  return (
    <div className="space-y-4">
      {/* Step 1 — zone + duration input */}
      <Card>
        <h3 className="text-lg font-bold text-foreground mb-1">I have time — find me a route</h3>
        <p className="text-xs text-muted mb-4 tabular-nums">
          {zonesData.readiness
            ? `${zonesData.readiness.readiness_note} (TSB ${zonesData.readiness.current_tsb}) — your pick still stands.`
            : 'Pick an intensity and a duration.'}
        </p>

        <p
          id="zoneflow-zone-label"
          className="text-xs text-muted font-medium uppercase tracking-wider mb-2"
        >
          Intensity zone
        </p>
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 mb-4" role="group" aria-labelledby="zoneflow-zone-label">
          {ZONE_OPTIONS.map((z) => (
            <button
              key={z.value}
              onClick={() => setZone(z.value)}
              aria-pressed={zone === z.value}
              className={`min-h-[44px] py-2 px-1 rounded-lg text-xs font-medium text-center transition-all border tabular-nums ${
                zone === z.value
                  ? 'border-accent bg-accent/20 text-foreground ring-1 ring-accent/30'
                  : 'border-surface-light bg-surface-light/30 text-muted hover:bg-surface-light/50'
              }`}
            >
              {z.short}
            </button>
          ))}
        </div>

        <p
          id="zoneflow-duration-label"
          className="text-xs text-muted font-medium uppercase tracking-wider mb-2"
        >
          Duration
        </p>
        <div
          className="grid grid-cols-4 sm:grid-cols-7 gap-2 mb-4"
          role="group"
          aria-labelledby="zoneflow-duration-label"
        >
          {DURATION_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setDuration(opt.value)}
              aria-pressed={duration === opt.value}
              className={`min-h-[44px] py-2 px-2 rounded-lg text-xs font-medium text-center transition-all border tabular-nums ${
                duration === opt.value
                  ? 'border-accent bg-accent/20 text-foreground ring-1 ring-accent/30'
                  : 'border-surface-light bg-surface-light/30 text-muted hover:bg-surface-light/50'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <button
          onClick={() => matchMutation.mutate()}
          disabled={matchMutation.isPending}
          className="w-full sm:w-auto min-h-[44px] px-5 py-2.5 bg-accent/20 text-accent border border-accent/30 rounded-lg hover:bg-accent/30 transition-colors font-medium text-sm disabled:opacity-50 tabular-nums"
        >
          {matchMutation.isPending
            ? 'Finding routes…'
            : `🗺️ Find ${zoneLabel(zone)} routes · ${durationLabel(duration)}`}
        </button>

        {matchMutation.isError && (
          <ErrorState
            variant="inline"
            title="Route search failed"
            message={(matchMutation.error as Error)?.message}
            onRetry={() => matchMutation.mutate()}
          />
        )}
      </Card>

      {/* Step 2 — workout targets (matcher depth, never hidden) */}
      {plan && (
        <Card className="border-accent/30 bg-accent/5">
          <h3 className="text-sm font-bold text-foreground mb-3 tabular-nums">
            🎯 {plan.zone_name} · {plan.duration_minutes} min target
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-center tabular-nums">
            <div className="bg-surface/60 rounded-lg p-2">
              <div className="text-xs text-muted">Power</div>
              <div className="text-sm font-bold text-foreground">
                {plan.target_power_low}–{plan.target_power_high}W
              </div>
            </div>
            <div className="bg-surface/60 rounded-lg p-2">
              <div className="text-xs text-muted">TSS</div>
              <div className="text-sm font-bold text-blue-400">
                {Math.round(plan.target_tss_low)}–{Math.round(plan.target_tss_high)}
              </div>
            </div>
            <div className="bg-surface/60 rounded-lg p-2">
              <div className="text-xs text-muted">Heart rate</div>
              <div className="text-sm font-bold text-warning">
                {plan.target_hr_low > 0 ? `${plan.target_hr_low}–${plan.target_hr_high}` : '—'}
              </div>
            </div>
            <div className="bg-surface/60 rounded-lg p-2">
              <div className="text-xs text-muted">Est. burn</div>
              <div className="text-sm font-bold text-foreground">
                {plan.estimated_calories_low}–{plan.estimated_calories_high}
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Steps 2–4 — matching routes */}
      {searched && !matchMutation.isError && (
        <div className="space-y-2">
          {matches.length === 0 ? (
            <Card>
              <div role="status" aria-live="polite" className="text-center py-4">
                <p className="text-4xl mb-3" aria-hidden="true">
                  🗺️
                </p>
                <p className="text-foreground font-medium mb-1">{empty.title}</p>
                <p className="text-muted text-xs max-w-md mx-auto mb-4">{empty.body}</p>
                <div className="flex flex-wrap justify-center gap-2">
                  <Link
                    href="/routes"
                    className="inline-flex items-center min-h-[44px] px-4 py-2 text-sm font-medium bg-accent hover:bg-accent-hover text-white rounded-lg transition-colors"
                  >
                    {empty.ctaLabel}
                  </Link>
                  <Link
                    href="/training"
                    className="inline-flex items-center min-h-[44px] px-4 py-2 text-sm font-medium text-muted hover:text-foreground rounded-lg transition-colors"
                  >
                    How matching works →
                  </Link>
                </div>
              </div>
            </Card>
          ) : (
            matches.map((m) => (
              <ZoneFlowRouteRow
                key={m.route_id}
                match={m}
                plan={plan}
                planId={planId}
                planDays={planDays}
                pushDay={pushDay}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
