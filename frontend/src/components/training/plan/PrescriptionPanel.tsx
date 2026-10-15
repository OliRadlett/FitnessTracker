'use client';

/**
 * PrescriptionPanel — the workout→route matching that used to live in the
 * standalone `WorkoutPlanner`, now inside the day editor's cycle section.
 *
 * Given the day's zone + duration it asks the workout planner for routes that
 * fit the workout (and how well), and lets the user assign one to the day.
 * The zones reference table + readiness banner from `WorkoutPlanner` are
 * dropped (readiness lives in the week strip; the zones table moved to the
 * cycling page).
 */

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Bike, MapPin, Mountain, RotateCw, Ruler, Timer } from 'lucide-react';

import type { RouteData, RouteMatchItem, TrainingWeekDay, WorkoutPlanResponse } from '@/lib/api';
import { useAuthFetch } from '@/lib/api';
import { RouteMap } from '@/components/maps/RouteMap';
import { formatDistance, formatElevation } from '@/lib/utils';

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
        <div
          className="absolute top-0 bottom-0 bg-accent/15 border-x border-accent/30"
          style={{ left: `${lowPct}%`, width: `${highPct - lowPct}%` }}
        />
        <div
          className={`absolute top-0 bottom-0 left-0 rounded-full ${color} opacity-80`}
          style={{ width: `${actualPct}%` }}
        />
      </div>
      <span className="text-foreground font-medium w-16 text-right shrink-0">
        {Math.round(actual)}
        {unit}
      </span>
      <span className="text-muted w-20 text-right shrink-0">
        ({Math.round(targetLow)}–{Math.round(targetHigh)}
        {unit})
      </span>
    </div>
  );
}

function ExpandableRouteMatch({
  match,
  target,
  onAssign,
}: {
  match: RouteMatchItem;
  target: WorkoutPlanResponse | null;
  onAssign: (routeId: string) => void;
}) {
  const { authFetch } = useAuthFetch();
  const [expanded, setExpanded] = useState(false);

  const { data: routeData } = useQuery<RouteData>({
    queryKey: ['route', match.route_id],
    queryFn: () => authFetch<RouteData>(`/api/v1/routes/${match.route_id}`),
    enabled: expanded,
    staleTime: 300_000,
  });

  const scoreColor =
    match.match_score >= 0.8 ? 'text-positive' : match.match_score >= 0.5 ? 'text-yellow-400' : 'text-muted';
  const scoreBg =
    match.match_score >= 0.8
      ? 'bg-green-500/15 border-green-500/30'
      : match.match_score >= 0.5
        ? 'bg-yellow-500/15 border-yellow-500/30'
        : 'bg-surface-light/30 border-surface-light';

  return (
    <div
      className={`rounded-lg border transition-all ${
        expanded ? scoreBg : 'bg-surface-light/30 border-surface-light/60 hover:bg-surface-light/50'
      }`}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-2.5 text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xs">{expanded ? '▼' : '▶'}</span>
            <p className="text-sm font-medium text-foreground truncate">{match.route_name}</p>
          </div>
          <div className="flex flex-wrap gap-3 text-[11px] text-muted mt-1 ml-5">
            <span className="inline-flex items-center gap-1">
              <Ruler className="w-3 h-3" />
              {formatDistance(match.distance_meters)}
            </span>
            <span className="inline-flex items-center gap-1">
              <Mountain className="w-3 h-3" />
              {formatElevation(match.elevation_gain_meters)}
            </span>
            {match.avg_duration_min != null && (
              <span className="inline-flex items-center gap-1">
                <Timer className="w-3 h-3" />
                {Math.round(match.avg_duration_min)}min
              </span>
            )}
            <span className="inline-flex items-center gap-1">
              <Bike className="w-3 h-3" />
              {match.ride_count} rides
            </span>
          </div>
        </div>
        <div className="text-right shrink-0 ml-3">
          <div className={`text-lg font-bold ${scoreColor}`}>{Math.round(match.match_score * 100)}%</div>
          <div className="text-[10px] text-muted">{match.is_estimated ? 'estimated' : 'historical'}</div>
        </div>
      </button>

      {expanded && (
        <div className="px-2.5 pb-2.5 pt-0 ml-5 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
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
            <div className="bg-surface/60 rounded-lg p-2 text-center">
              <div className="text-[10px] text-muted">Type</div>
              <div className="text-sm font-semibold text-foreground">
                {match.is_loop ? (
                  <>
                    <RotateCw className="w-3 h-3 mr-1" />
                    Loop
                  </>
                ) : (
                  <>
                    <ArrowRight className="w-3 h-3 mr-1" />
                    Point-to-point
                  </>
                )}
              </div>
            </div>
            <div className="bg-surface/60 rounded-lg p-2 text-center">
              <div className="text-[10px] text-muted">Confidence</div>
              <div className="text-sm font-semibold text-foreground">{Math.round(match.confidence * 100)}%</div>
            </div>
          </div>

          {target && (
            <div className="bg-surface/40 rounded-lg p-2.5 border border-surface-light/30 space-y-1.5">
              <p className="text-xs font-medium text-foreground/80">Workout fit</p>
              {match.avg_tss != null && (
                <FitBar label="TSS" actual={match.avg_tss} targetLow={target.target_tss_low} targetHigh={target.target_tss_high} unit="" />
              )}
              {match.avg_power != null && (
                <FitBar label="Power" actual={match.avg_power} targetLow={target.target_power_low} targetHigh={target.target_power_high} unit="W" />
              )}
              {match.avg_duration_min != null && (
                <FitBar
                  label="Duration"
                  actual={match.avg_duration_min}
                  targetLow={target.duration_minutes * 0.8}
                  targetHigh={target.duration_minutes * 1.2}
                  unit="min"
                />
              )}
            </div>
          )}

          {routeData?.encoded_polyline && (
            <div className="rounded-lg overflow-hidden border border-surface-light/30">
              <RouteMap encodedPolyline={routeData.encoded_polyline} isLoop={match.is_loop} className="h-[220px] w-full" />
            </div>
          )}

          <button
            onClick={() => onAssign(match.route_id)}
            className="w-full px-3 py-2 bg-accent/20 text-accent border border-accent/30 rounded-lg text-xs font-medium hover:bg-accent/30 transition-colors"
          >
            Assign this route
          </button>
        </div>
      )}
    </div>
  );
}

export interface PrescriptionPanelProps {
  day: TrainingWeekDay;
  onAssignRoute: (routeId: string) => void;
}

export function PrescriptionPanel({ day, onAssignRoute }: PrescriptionPanelProps) {
  const { authFetch } = useAuthFetch();
  const [matches, setMatches] = useState<RouteMatchItem[] | null>(null);
  const [target, setTarget] = useState<WorkoutPlanResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The workout planner takes a zone code ('z2'); stored values may be a code
  // or a label, so normalise defensively.
  const zone = (day.planned_zone ?? 'z2').toLowerCase().slice(0, 2);
  const duration = day.planned_duration_min ?? 60;

  const findRoutes = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await authFetch<{ matches: RouteMatchItem[]; workout_target?: WorkoutPlanResponse }>(
        '/api/v1/workout-planner/match-routes',
        {
          method: 'POST',
          body: JSON.stringify({ difficulty: zone, duration_minutes: duration, max_results: 5 }),
        },
      );
      setMatches(res.matches);
      setTarget(res.workout_target ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not find matching routes');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <p className="text-[10px] font-medium text-muted uppercase tracking-wide">Matching routes</p>
        <button
          onClick={findRoutes}
          disabled={busy}
          className="ml-auto text-[10px] text-accent hover:text-accent/80 disabled:opacity-50 inline-flex items-center gap-1"
        >
          <MapPin className="w-3 h-3" />
          {busy ? 'Finding…' : 'Find matching routes'}
        </button>
      </div>
      {error && <p className="text-[11px] text-warning">{error}</p>}
      {matches && matches.length === 0 && (
        <p className="text-[11px] text-muted">No routes fit this workout — try a different duration.</p>
      )}
      {matches && matches.length > 0 && (
        <div className="space-y-2">
          {matches.map((m) => (
            <ExpandableRouteMatch key={m.route_id} match={m} target={target} onAssign={onAssignRoute} />
          ))}
        </div>
      )}
    </div>
  );
}
