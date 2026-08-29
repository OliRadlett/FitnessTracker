'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useAuthFetch } from '@/lib/api';
import { Card } from '@/components/ui/Card';
import { RouteMap } from '@/components/maps/RouteMap';
import { formatDistance } from '@/lib/utils';
import type {
  WorkoutZonesResponse,
  WorkoutPlanResponse,
  RouteMatchResponse,
  RouteData,
} from '@/lib/api';

const ZONE_LABELS: Record<string, string> = {
  z1: '🟢 Z1 — Very Easy',
  z2: '🔵 Z2 — Easy',
  z3: '🟡 Z3 — Moderate',
  z4: '🟠 Z4 — Hard',
  z5: '🔴 Z5 — Very Hard',
};

const DURATION_OPTIONS = [
  { value: 30, label: '30 min' },
  { value: 45, label: '45 min' },
  { value: 60, label: '1 hr' },
  { value: 75, label: '1h 15m' },
  { value: 90, label: '1h 30m' },
  { value: 120, label: '2 hrs' },
  { value: 150, label: '2h 30m' },
  { value: 180, label: '3 hrs' },
];

function formatElevation(meters?: number): string {
  if (meters == null) return '—';
  return `${Math.round(meters)}m`;
}

function ExpandableRouteMatch({
  match,
  plan,
}: {
  match: import('@/lib/api').RouteMatchItem;
  plan: import('@/lib/api').WorkoutPlanResponse | null;
}) {
  const { authFetch } = useAuthFetch();
  const [expanded, setExpanded] = useState(false);

  // Fetch route details (with polyline) when expanded
  const { data: routeData } = useQuery<RouteData>({
    queryKey: ['route', match.route_id],
    queryFn: () => authFetch<RouteData>(`/api/v1/routes/${match.route_id}`),
    enabled: expanded,
    staleTime: 300_000,
  });

  const scoreColor = match.match_score >= 0.8 ? 'text-positive'
    : match.match_score >= 0.5 ? 'text-yellow-400'
    : 'text-muted';

  const scoreBg = match.match_score >= 0.8 ? 'bg-green-500/15 border-green-500/30'
    : match.match_score >= 0.5 ? 'bg-yellow-500/15 border-yellow-500/30'
    : 'bg-surface-light/30 border-surface-light';

  return (
    <div className={`rounded-lg border transition-all ${expanded ? scoreBg : 'bg-surface-light/30 border-surface-light/60 hover:bg-surface-light/50'}`}>
      {/* Header row — always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-3 text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm">{expanded ? '▼' : '▶'}</span>
            <p className="text-sm font-medium text-white truncate">{match.route_name}</p>
          </div>
          <div className="flex flex-wrap gap-3 text-xs text-muted mt-1 ml-5">
            <span>📏 {formatDistance(match.distance_meters)}</span>
            <span>⛰️ {formatElevation(match.elevation_gain_meters)}</span>
            {match.avg_duration_min != null && <span>⏱ {Math.round(match.avg_duration_min)}min</span>}
            <span>🚴 {match.ride_count} rides</span>
          </div>
        </div>
        <div className="text-right shrink-0 ml-3">
          <div className={`text-lg font-bold ${scoreColor}`}>
            {Math.round(match.match_score * 100)}%
          </div>
          <div className="text-[10px] text-muted">
            {match.is_estimated ? 'estimated' : 'historical'}
          </div>
        </div>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-3 pb-3 pt-0 ml-5 space-y-3">
          {/* Route stats grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="bg-surface/60 rounded-lg p-2 text-center">
              <div className="text-[10px] text-muted">Distance</div>
              <div className="text-sm font-semibold text-white">{formatDistance(match.distance_meters)}</div>
            </div>
            <div className="bg-surface/60 rounded-lg p-2 text-center">
              <div className="text-[10px] text-muted">Elevation</div>
              <div className="text-sm font-semibold text-white">{formatElevation(match.elevation_gain_meters)}</div>
            </div>
            {match.avg_tss != null && (
              <div className="bg-surface/60 rounded-lg p-2 text-center">
                <div className="text-[10px] text-muted">Avg TSS</div>
                <div className="text-sm font-semibold text-blue-400">{Math.round(match.avg_tss)}</div>
              </div>
            )}
            {match.avg_power != null && (
              <div className="bg-surface/60 rounded-lg p-2 text-center">
                <div className="text-[10px] text-muted">Avg Power</div>
                <div className="text-sm font-semibold text-yellow-400">{Math.round(match.avg_power)}W</div>
              </div>
            )}
            {match.avg_hr != null && (
              <div className="bg-surface/60 rounded-lg p-2 text-center">
                <div className="text-[10px] text-muted">Avg HR</div>
                <div className="text-sm font-semibold text-warning">{Math.round(match.avg_hr)} bpm</div>
              </div>
            )}
            {match.avg_duration_min != null && (
              <div className="bg-surface/60 rounded-lg p-2 text-center">
                <div className="text-[10px] text-muted">Avg Duration</div>
                <div className="text-sm font-semibold text-white">{Math.round(match.avg_duration_min)} min</div>
              </div>
            )}
            <div className="bg-surface/60 rounded-lg p-2 text-center">
              <div className="text-[10px] text-muted">Type</div>
              <div className="text-sm font-semibold text-white">{match.is_loop ? '🔄 Loop' : '➡️ Point-to-point'}</div>
            </div>
            <div className="bg-surface/60 rounded-lg p-2 text-center">
              <div className="text-[10px] text-muted">Confidence</div>
              <div className="text-sm font-semibold text-white">{Math.round(match.confidence * 100)}%</div>
            </div>
          </div>

          {/* Workout fit analysis */}
          {plan && (
            <div className="bg-surface/40 rounded-lg p-3 border border-surface-light/30">
              <p className="text-xs font-medium text-white/80 mb-2">Workout Fit Analysis</p>
              <div className="space-y-1.5">
                {match.avg_tss != null && (
                  <FitBar
                    label="TSS"
                    actual={match.avg_tss}
                    targetLow={plan.target_tss_low}
                    targetHigh={plan.target_tss_high}
                    unit=""
                  />
                )}
                {match.avg_power != null && (
                  <FitBar
                    label="Power"
                    actual={match.avg_power}
                    targetLow={plan.target_power_low}
                    targetHigh={plan.target_power_high}
                    unit="W"
                  />
                )}
                {match.avg_duration_min != null && (
                  <FitBar
                    label="Duration"
                    actual={match.avg_duration_min}
                    targetLow={plan.duration_minutes * 0.8}
                    targetHigh={plan.duration_minutes * 1.2}
                    unit="min"
                  />
                )}
              </div>
            </div>
          )}

          {/* Route Map */}
          {routeData?.encoded_polyline && (
            <div className="rounded-lg overflow-hidden border border-surface-light/30">
              <RouteMap
                encodedPolyline={routeData.encoded_polyline}
                isLoop={match.is_loop}
                className="h-[250px] w-full"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FitBar({
  label,
  actual,
  targetLow,
  targetHigh,
  unit,
}: {
  label: string;
  actual: number;
  targetLow: number;
  targetHigh: number;
  unit: string;
}) {
  const maxVal = Math.max(actual, targetHigh) * 1.2;
  const actualPct = Math.min((actual / maxVal) * 100, 100);
  const lowPct = (targetLow / maxVal) * 100;
  const highPct = (targetHigh / maxVal) * 100;

  const isInRange = actual >= targetLow * 0.8 && actual <= targetHigh * 1.2;
  const color = isInRange ? 'bg-green-500' : actual < targetLow ? 'bg-blue-500' : 'bg-orange-500';

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-muted w-16 shrink-0">{label}</span>
      <div className="flex-1 h-3 bg-surface-light/40 rounded-full relative overflow-hidden">
        {/* Target range indicator */}
        <div
          className="absolute top-0 bottom-0 bg-accent/15 border-x border-accent/30"
          style={{ left: `${lowPct}%`, width: `${highPct - lowPct}%` }}
        />
        {/* Actual value bar */}
        <div
          className={`absolute top-0 bottom-0 left-0 rounded-full ${color} opacity-80`}
          style={{ width: `${actualPct}%` }}
        />
      </div>
      <span className="text-white font-medium w-16 text-right shrink-0">
        {Math.round(actual)}{unit}
      </span>
      <span className="text-muted w-20 text-right shrink-0">
        ({Math.round(targetLow)}–{Math.round(targetHigh)}{unit})
      </span>
    </div>
  );
}

export function WorkoutPlanner() {
  const { authFetch } = useAuthFetch();
  const [selectedZone, setSelectedZone] = useState<string>('z2');
  const [duration, setDuration] = useState<number>(60);
  const [showRoutes, setShowRoutes] = useState(false);

  // Fetch zones
  const { data: zonesData, isLoading: zonesLoading, isError: zonesIsError, error: zonesErrorObj } = useQuery<WorkoutZonesResponse>({
    queryKey: ['workout-zones'],
    queryFn: () => authFetch<WorkoutZonesResponse>('/api/v1/workout-planner/zones'),
    staleTime: 300_000,
  });

  // Plan workout mutation
  const [planResult, setPlanResult] = useState<WorkoutPlanResponse | null>(null);
  const [routeResult, setRouteResult] = useState<RouteMatchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const planMutation = useMutation({
    mutationFn: () =>
      authFetch<WorkoutPlanResponse>('/api/v1/workout-planner/plan', {
        method: 'POST',
        body: JSON.stringify({ difficulty: selectedZone, duration_minutes: duration }),
      }),
    onSuccess: (data) => {
      setPlanResult(data);
      setError(null);
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  // Match routes mutation
  const matchMutation = useMutation({
    mutationFn: () =>
      authFetch<RouteMatchResponse>('/api/v1/workout-planner/match-routes', {
        method: 'POST',
        body: JSON.stringify({ difficulty: selectedZone, duration_minutes: duration, max_results: 5 }),
      }),
    onSuccess: (data) => {
      setRouteResult(data);
      if (data.workout_target) {
        setPlanResult(data.workout_target);
      }
      setError(null);
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const handlePlan = () => {
    planMutation.mutate();
    setShowRoutes(false);
  };

  const handleMatchRoutes = () => {
    matchMutation.mutate();
    setShowRoutes(true);
  };

  const plan = planResult;
  const routeMatches = routeResult;
  const readiness = zonesData?.readiness;

  if (zonesLoading) {
    return (
      <Card>
        <div className="animate-pulse space-y-4">
          <div className="h-5 bg-surface-light rounded w-48"></div>
          <div className="h-40 bg-surface-light/40 rounded-lg"></div>
        </div>
      </Card>
    );
  }

  if (zonesIsError && zonesErrorObj) {
    return (
      <Card>
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-red-300 text-sm">
          Failed to load workout zones: {zonesErrorObj.message}
        </div>
      </Card>
    );
  }

  if (!zonesData?.ftp_watts) {
    return (
      <Card className="border-yellow-500/30 bg-yellow-500/5">
        <p className="text-sm text-yellow-400">
          ⚠️ Set your FTP on the{' '}
          <Link href="/cycling" className="underline hover:text-yellow-300">Cycling page</Link>{' '}
          to use the Workout Planner.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Zone Reference + Readiness */}
      <Card>
        <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
          <span>🎯</span> Workout Zones
          <span className="text-sm font-normal text-muted">(FTP: {Math.round(zonesData.ftp_watts)}W)</span>
        </h3>

        {/* Readiness banner */}
        {readiness && (
          <div className={`mb-4 p-3 rounded-lg border ${
            readiness.is_fatigued
              ? 'bg-red-500/10 border-red-500/30'
              : readiness.current_tsb > 10
                ? 'bg-green-500/10 border-green-500/30'
                : 'bg-blue-500/10 border-blue-500/30'
          }`}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-white">{readiness.readiness_note}</p>
                <p className="text-xs text-muted mt-1">
                  CTL: {readiness.current_ctl} · ATL: {readiness.current_atl} · TSB: {readiness.current_tsb > 0 ? '+' : ''}{readiness.current_tsb}
                </p>
              </div>
              <span className={`text-xs font-medium px-2 py-1 rounded ${
                readiness.is_fatigued ? 'bg-red-500/20 text-warning' : 'bg-green-500/20 text-positive'
              }`}>
                Max: {ZONE_LABELS[readiness.recommended_max_zone]?.split(' — ')[1] || readiness.recommended_max_zone}
              </span>
            </div>
          </div>
        )}

        {/* Zone table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted text-xs uppercase tracking-wider border-b border-surface-light">
                <th className="text-left py-2 pr-3">Zone</th>
                <th className="text-center py-2 px-2">IF</th>
                <th className="text-center py-2 px-2">Power</th>
                <th className="text-center py-2 px-2">HR</th>
                <th className="text-center py-2 px-2">TSS/hr</th>
              </tr>
            </thead>
            <tbody>
              {zonesData.zones.map((z) => {
                const isRecommended = readiness
                  ? parseInt(z.zone.slice(1)) <= parseInt(readiness.recommended_max_zone.slice(1))
                  : true;
                return (
                  <tr
                    key={z.zone}
                    className={`border-b border-surface-light/30 transition-colors ${
                      selectedZone === z.zone
                        ? 'bg-accent/10'
                        : isRecommended
                          ? 'hover:bg-surface-light/30 cursor-pointer'
                          : 'opacity-40'
                    }`}
                    onClick={() => isRecommended && setSelectedZone(z.zone)}
                  >
                    <td className="py-2 pr-3">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: z.color }} />
                        <span className="font-medium text-white">{z.name}</span>
                      </div>
                    </td>
                    <td className="text-center py-2 px-2 text-muted">
                      {z.if_low.toFixed(2)}–{z.if_high.toFixed(2)}
                    </td>
                    <td className="text-center py-2 px-2 text-white font-medium">
                      {z.power_low}–{z.power_high}W
                    </td>
                    <td className="text-center py-2 px-2 text-muted">
                      {z.hr_low > 0 ? `${z.hr_low}–${z.hr_high}` : '—'}
                    </td>
                    <td className="text-center py-2 px-2 text-muted">
                      {z.tss_per_hour_low.toFixed(0)}–{z.tss_per_hour_high.toFixed(0)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Workout Planner Form */}
      <Card>
        <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
          <span>📋</span> Plan a Workout
        </h3>

        <div className="flex flex-wrap gap-4 mb-4">
          {/* Zone selector */}
          <div className="flex-1 min-w-[200px]">
            <label className="text-xs text-muted font-medium uppercase tracking-wider mb-2 block">
              Intensity Zone
            </label>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-1">
              {zonesData.zones.map((z) => {
                const isRecommended = readiness
                  ? parseInt(z.zone.slice(1)) <= parseInt(readiness.recommended_max_zone.slice(1))
                  : true;
                return (
                  <button
                    key={z.zone}
                    onClick={() => isRecommended && setSelectedZone(z.zone)}
                    disabled={!isRecommended}
                    className={`py-2 px-1 rounded-lg text-xs font-medium text-center transition-all border ${
                      selectedZone === z.zone
                        ? 'border-accent bg-accent/20 text-white ring-1 ring-accent/30'
                        : isRecommended
                          ? 'border-surface-light bg-surface-light/30 text-muted hover:bg-surface-light/50'
                          : 'border-surface-light/30 bg-surface/30 text-muted/40 cursor-not-allowed'
                    }`}
                  >
                    <div className="w-2 h-2 rounded-full mx-auto mb-1" style={{ backgroundColor: z.color }} />
                    {z.zone.toUpperCase()}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Duration selector */}
          <div className="min-w-[200px]">
            <label className="text-xs text-muted font-medium uppercase tracking-wider mb-2 block">
              Duration
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1">
              {DURATION_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setDuration(opt.value)}
                  className={`py-2 px-2 rounded-lg text-xs font-medium text-center transition-all border ${
                    duration === opt.value
                      ? 'border-accent bg-accent/20 text-white ring-1 ring-accent/30'
                      : 'border-surface-light bg-surface-light/30 text-muted hover:bg-surface-light/50'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex gap-3">
          <button
            onClick={handlePlan}
            disabled={planMutation.isPending}
            className="px-5 py-2.5 bg-accent/20 text-accent border border-accent/30 rounded-lg hover:bg-accent/30 transition-colors font-medium text-sm disabled:opacity-50"
          >
            {planMutation.isPending ? 'Planning...' : '🎯 Plan Workout'}
          </button>
          <button
            onClick={handleMatchRoutes}
            disabled={matchMutation.isPending}
            className="px-5 py-2.5 bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded-lg hover:bg-blue-500/30 transition-colors font-medium text-sm disabled:opacity-50"
          >
            {matchMutation.isPending ? 'Finding...' : '🗺️ Find Matching Routes'}
          </button>
        </div>

        {error && (
          <p className="text-xs text-warning mt-3">⚠️ {error}</p>
        )}
      </Card>

      {/* Workout Targets */}
      {plan && (
        <Card className="border-accent/30 bg-accent/5">
          <h3 className="text-lg font-bold text-white mb-3 flex items-center gap-2">
            <span>🎯</span> Workout Targets
            <span className="text-sm font-normal text-muted">
              {plan.zone_name} · {plan.duration_minutes} min
            </span>
          </h3>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-surface/60 rounded-lg p-3 text-center">
              <div className="text-xs text-muted mb-1">Power</div>
              <div className="text-lg font-bold text-white">
                {plan.target_power_low}–{plan.target_power_high}W
              </div>
            </div>
            <div className="bg-surface/60 rounded-lg p-3 text-center">
              <div className="text-xs text-muted mb-1">Intensity Factor</div>
              <div className="text-lg font-bold text-yellow-400">
                {plan.target_if_low.toFixed(2)}–{plan.target_if_high.toFixed(2)}
              </div>
            </div>
            <div className="bg-surface/60 rounded-lg p-3 text-center">
              <div className="text-xs text-muted mb-1">Heart Rate</div>
              <div className="text-lg font-bold text-warning">
                {plan.target_hr_low > 0 ? `${plan.target_hr_low}–${plan.target_hr_high} bpm` : '—'}
              </div>
            </div>
            <div className="bg-surface/60 rounded-lg p-3 text-center">
              <div className="text-xs text-muted mb-1">TSS</div>
              <div className="text-lg font-bold text-blue-400">
                {Math.round(plan.target_tss_low)}–{Math.round(plan.target_tss_high)}
              </div>
            </div>
          </div>

          <div className="mt-3 flex gap-4 text-xs text-muted">
            <span>🔥 Est. {plan.estimated_calories_low}–{plan.estimated_calories_high} cal</span>
          </div>
        </Card>
      )}

      {/* Route Matches */}
      {showRoutes && routeMatches && (
        <Card>
          <h3 className="text-lg font-bold text-white mb-3 flex items-center gap-2">
            <span>🗺️</span> Matching Routes
          </h3>

          {routeMatches.matches.length === 0 ? (
            <p className="text-sm text-muted">No routes found matching this workout. Try a different zone or duration.</p>
          ) : (
            <div className="space-y-2">
              {routeMatches.matches.map((match) => (
                <ExpandableRouteMatch
                  key={match.route_id}
                  match={match}
                  plan={plan}
                />
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
