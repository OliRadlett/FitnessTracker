'use client';

/**
 * ZoneFlowRouteRow — one matching route in the ZoneFlow list (ui-redesign-v2 §4.3).
 *
 * Data maximalism: every matcher field is shown somewhere — header carries
 * name, match %, distance, elevation, est TSS, duration, ride count,
 * loop/point-to-point, confidence + historical/estimated provenance, and the
 * per-route weather badge. Expanding reveals the mini-map preview
 * (`RouteMap`, import-only), the effort/fuel estimate (`EffortEstimateCard`,
 * import-only: est time/TSS/kcal), the top surface type, and the two actions.
 *
 * Actions (both need a plan day; without plan context they degrade to an
 * honest note linking to /training — never a dead button):
 * - [Push to Wahoo]: assigns this route to the target day via the existing
 *   `updatePlanDay` client, then opens the existing `WahooPushModal`
 *   (import-only) with the updated day — one tap + confirm.
 * - [Plan workout]: writes the matcher's mid-range power/TSS targets to the
 *   target day (same payload shape as WorkoutPlanner's RM1 write-back).
 */

import React, { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { updatePlanDay, useAuthFetch } from '@/lib/api';
import type {
  RouteData,
  RouteMatchItem,
  TrainingPlanDay,
  TrainingWeekDay,
  WorkoutPlanResponse,
} from '@/lib/api';
import { RouteMap } from '@/components/maps/RouteMap';
import { EffortEstimateCard } from '@/components/routes/EffortEstimateCard';
import { WahooPushModal } from '@/components/training/WahooPushModal';
import { formatDistance, formatElevation } from '@/lib/utils';
import { ZoneFlowWeatherBadge } from './ZoneFlowWeatherBadge';
import { estimateTss, matchCardClass, matchScoreClass } from './zoneFlowUtils';

interface ZoneFlowRouteRowProps {
  match: RouteMatchItem;
  plan: WorkoutPlanResponse | null;
  /** Optional plan context (passed through by ZoneFlow; enables push/plan). */
  planId?: string | null;
  planDays?: TrainingPlanDay[];
  /** Pre-selected cycle day for one-tap push (e.g. today's plan day). */
  pushDay?: TrainingWeekDay | null;
}

function topSurface(surface?: Record<string, number> | null): string | null {
  if (!surface) return null;
  const entries = Object.entries(surface);
  if (entries.length === 0) return null;
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][0];
}

export function ZoneFlowRouteRow({
  match,
  plan,
  planId,
  planDays,
  pushDay,
}: ZoneFlowRouteRowProps) {
  const { authFetch, token } = useAuthFetch();
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [targetDayId, setTargetDayId] = useState(pushDay?.id ?? '');
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [wahooOpen, setWahooOpen] = useState(false);
  const [wahooDay, setWahooDay] = useState<TrainingWeekDay | null>(null);

  // Shared ['route', id] cache entry with WorkoutPlanner — no duplicate fetch.
  // Eager (not expand-gated): the header weather badge needs the route's
  // start coordinates, and the list is capped at 3 rows, so at most 3 small
  // cached requests fire per search.
  const { data: routeData, isPending: routePending } = useQuery<RouteData>({
    queryKey: ['route', match.route_id],
    queryFn: () => authFetch<RouteData>(`/api/v1/routes/${match.route_id}`),
    enabled: !!token,
    staleTime: 300_000,
  });

  const hasPlanContext = !!planId && (!!pushDay || (planDays?.length ?? 0) > 0);
  const tss = estimateTss(match, plan);
  const surface = topSurface(routeData?.surface_profile);

  const planMutation = useMutation({
    mutationFn: (dayId: string) => {
      if (!plan || !planId) throw new Error('No workout or plan selected');
      const midPower = Math.round((plan.target_power_low + plan.target_power_high) / 2);
      const midTss = Math.round((plan.target_tss_low + plan.target_tss_high) / 2);
      return updatePlanDay(authFetch, planId, dayId, {
        sport: 'cycle',
        planned_duration_min: plan.duration_minutes,
        planned_tss: midTss,
        planned_power_watts: midPower,
        planned_zone: plan.zone_name,
        planned_route_id: match.route_id,
        workout_description: `${plan.zone_name} · ${plan.duration_minutes} min · ${midPower}W · ~${midTss} TSS · ${match.route_name} (from ZoneFlow)`,
      });
    },
    onSuccess: () => {
      setActionMsg('✓ Added to plan day.');
      if (planId) {
        queryClient.invalidateQueries({ queryKey: ['plan-week', planId] });
        queryClient.invalidateQueries({ queryKey: ['training-plan', planId] });
      }
    },
    onError: (err: Error) => {
      setActionMsg(`⚠️ ${err.message}`);
    },
  });

  const pushMutation = useMutation({
    mutationFn: (dayId: string) => {
      if (!planId) throw new Error('No plan selected');
      return updatePlanDay(authFetch, planId, dayId, {
        planned_route_id: match.route_id,
      });
    },
    onSuccess: (updated, dayId) => {
      const base =
        pushDay && pushDay.id === dayId
          ? pushDay
          : (planDays?.find((d) => d.id === dayId) ?? null);
      if (base) {
        // TrainingWeekDay extras are all optional, so a TrainingPlanDay
        // spread satisfies the WahooPushModal prop type.
        setWahooDay({ ...base, ...updated, planned_route_id: match.route_id });
        setWahooOpen(true);
        setActionMsg(null);
      }
      if (planId) {
        queryClient.invalidateQueries({ queryKey: ['plan-week', planId] });
      }
    },
    onError: (err: Error) => {
      setActionMsg(`⚠️ ${err.message}`);
    },
  });

  return (
    <div
      className={`rounded-lg border transition-all ${matchCardClass(match.match_score, expanded)}`}
    >
      {/* Header row — always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="w-full min-h-[44px] flex items-center justify-between gap-3 p-3 text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted" aria-hidden="true">
              {expanded ? '▼' : '▶'}
            </span>
            <p className="text-sm font-medium text-white truncate">{match.route_name}</p>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted mt-1 ml-5 tabular-nums">
            <span>📏 {formatDistance(match.distance_meters)}</span>
            <span>⛰️ {formatElevation(match.elevation_gain_meters)}</span>
            {tss != null && <span>⚡ ~{tss} TSS</span>}
            {match.avg_duration_min != null && (
              <span>⏱ {Math.round(match.avg_duration_min)}m</span>
            )}
            <span>🚴 {match.ride_count} rides</span>
            <span>{match.is_loop ? '🔄 Loop' : '➡️ Point-to-point'}</span>
          </div>
          <div className="ml-5 mt-1">
            <ZoneFlowWeatherBadge
              lat={routeData?.start_lat}
              lng={routeData?.start_lng}
              loading={routePending}
            />
          </div>
        </div>
        <div className="text-right shrink-0 ml-3">
          <div className={`text-lg font-bold tabular-nums ${matchScoreClass(match.match_score)}`}>
            {Math.round(match.match_score * 100)}%
          </div>
          <div className="text-xs text-muted">
            {match.is_estimated ? 'estimated' : 'historical'} · {Math.round(match.confidence * 100)}%
          </div>
        </div>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-3 pb-3 pt-0 ml-5 space-y-3">
          {/* Full matcher depth grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 tabular-nums">
            <div className="bg-surface/60 rounded-lg p-2 text-center">
              <div className="text-xs text-muted">Distance</div>
              <div className="text-sm font-semibold text-foreground">
                {formatDistance(match.distance_meters)}
              </div>
            </div>
            <div className="bg-surface/60 rounded-lg p-2 text-center">
              <div className="text-xs text-muted">Elevation</div>
              <div className="text-sm font-semibold text-foreground">
                {formatElevation(match.elevation_gain_meters)}
              </div>
            </div>
            <div className="bg-surface/60 rounded-lg p-2 text-center">
              <div className="text-xs text-muted">Est. TSS</div>
              <div className="text-sm font-semibold text-blue-400">
                {tss != null ? `~${tss}` : '—'}
              </div>
            </div>
            <div className="bg-surface/60 rounded-lg p-2 text-center">
              <div className="text-xs text-muted">Match</div>
              <div className={`text-sm font-semibold ${matchScoreClass(match.match_score)}`}>
                {Math.round(match.match_score * 100)}%
              </div>
            </div>
            {match.avg_power != null && (
              <div className="bg-surface/60 rounded-lg p-2 text-center">
                <div className="text-xs text-muted">Avg Power</div>
                <div className="text-sm font-semibold text-yellow-400">
                  {Math.round(match.avg_power)}W
                </div>
              </div>
            )}
            {match.avg_hr != null && (
              <div className="bg-surface/60 rounded-lg p-2 text-center">
                <div className="text-xs text-muted">Avg HR</div>
                <div className="text-sm font-semibold text-warning">
                  {Math.round(match.avg_hr)} bpm
                </div>
              </div>
            )}
            {surface && (
              <div className="bg-surface/60 rounded-lg p-2 text-center">
                <div className="text-xs text-muted">Surface</div>
                <div className="text-sm font-semibold text-foreground capitalize">{surface}</div>
              </div>
            )}
            <div className="bg-surface/60 rounded-lg p-2 text-center">
              <div className="text-xs text-muted">Confidence</div>
              <div className="text-sm font-semibold text-foreground">
                {Math.round(match.confidence * 100)}%
              </div>
            </div>
          </div>

          {/* Route preview mini-map */}
          {routeData?.encoded_polyline ? (
            <div className="rounded-lg overflow-hidden border border-surface-light/30">
              <RouteMap
                encodedPolyline={routeData.encoded_polyline}
                isLoop={match.is_loop}
                className="h-[250px] w-full"
              />
            </div>
          ) : (
            <p className="text-xs text-muted">
              {routePending ? 'Loading map preview…' : 'No map preview for this route.'}
            </p>
          )}

          {/* Fuel + effort estimate (import-only reuse) */}
          <div className="bg-surface/40 rounded-lg p-3 border border-surface-light/30">
            <EffortEstimateCard routeId={match.route_id} />
          </div>

          {/* Actions */}
          {hasPlanContext ? (
            <div className="flex flex-wrap items-center gap-2">
              {!pushDay && (
                <select
                  value={targetDayId}
                  onChange={(e) => {
                    setTargetDayId(e.target.value);
                    setActionMsg(null);
                  }}
                  aria-label="Plan day for this route"
                  className="flex-1 min-w-[180px] min-h-[44px] px-2 py-2 bg-background border border-surface-light rounded-lg text-foreground text-xs focus:outline-none focus:border-accent"
                >
                  <option value="">Target plan day…</option>
                  {(planDays ?? []).map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.day_date} — {d.sport}{d.completed ? ' ✓' : ''}
                    </option>
                  ))}
                </select>
              )}
              <button
                onClick={() => targetDayId && planMutation.mutate(targetDayId)}
                disabled={!targetDayId || planMutation.isPending}
                className="flex-1 min-h-[44px] px-4 py-2 bg-accent/20 text-accent border border-accent/30 rounded-lg hover:bg-accent/30 transition-colors font-medium text-sm disabled:opacity-40"
              >
                {planMutation.isPending ? 'Planning…' : '📋 Plan workout'}
              </button>
              <button
                onClick={() => targetDayId && pushMutation.mutate(targetDayId)}
                disabled={!targetDayId || pushMutation.isPending}
                className="flex-1 min-h-[44px] px-4 py-2 bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded-lg hover:bg-blue-500/30 transition-colors font-medium text-sm disabled:opacity-40"
              >
                {pushMutation.isPending ? 'Assigning…' : '📤 Push to Wahoo'}
              </button>
              {actionMsg && <span className="text-xs text-muted w-full">{actionMsg}</span>}
            </div>
          ) : (
            <p className="text-xs text-muted">
              To push this route to Wahoo or plan it, open this flow from a training plan day.{' '}
              <Link href="/training" className="underline text-accent hover:text-accent-hover">
                Browse plans →
              </Link>
            </p>
          )}
        </div>
      )}

      {/* Wahoo push modal — existing component, import-only reuse */}
      {planId && (
        <WahooPushModal
          open={wahooOpen}
          onClose={() => setWahooOpen(false)}
          planId={planId}
          day={wahooDay}
        />
      )}
    </div>
  );
}
