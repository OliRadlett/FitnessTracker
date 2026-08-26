'use client';

import React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useAuthFetch, getPlanWeek, getTrainingPlans } from '@/lib/api';
import type {
  TodaySummary,
  DashboardSummary,
  ReadinessResponse,
  RespiratoryRateResponse,
  Event,
  ChartData,
  TrainingWeekDay,
  TrainingWeekResponse,
  TrainingPlanSummary,
} from '@/lib/api';
import { ReadinessIndicator } from '@/components/ui/ReadinessIndicator';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { ChartBody } from '@/components/charts/Chart';
import { Badge, getSportBadgeVariant } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonMetric } from '@/components/ui/Skeleton';
import { weatherEmoji } from '@/lib/utils';
import { getCurrentWeek, toDateStr } from '@/lib/training/week';
import { RestDayBanner } from './RestDayBanner';
import { MetricCard, RespiratoryRateCard, formatDistance, formatDuration, ListSkeleton } from './helpers';

// ── Sport emoji for plan day ──────────────────────────────────────────────

const SPORT_EMOJI: Record<string, string> = {
  cycle: '🚴',
  strength: '🏋️',
  rest: '😴',
};

const DAY_TYPE_COLORS: Record<string, string> = {
  rest: 'text-gray-400',
  easy: 'text-positive',
  moderate: 'text-blue-400',
  hard: 'text-orange-400',
  race: 'text-warning',
};

// ── Props ─────────────────────────────────────────────────────────────────

interface TodayTabProps {
  todaySummary: TodaySummary | undefined;
  isLoading: boolean;
  summary: DashboardSummary | undefined;
  readiness: ReadinessResponse | undefined;
  hasReadiness: boolean;
  respiratoryRate: RespiratoryRateResponse | undefined;
  upcomingEvents: Event[] | undefined;
}

// ── Component ─────────────────────────────────────────────────────────────

export function TodayTab({
  todaySummary,
  isLoading,
  summary,
  readiness,
  hasReadiness,
  respiratoryRate,
  upcomingEvents,
}: TodayTabProps) {
  const { authFetch } = useAuthFetch();

  // ── Training load chart (CTL / ATL / TSB trend) ─────────────────────────
  const { data: trainingLoadChart, isLoading: trainingLoadLoading } = useQuery<ChartData>({
    queryKey: ['chart-training-load', 90],
    queryFn: () => authFetch<ChartData>('/api/v1/charts/training_load?days=90'),
    staleTime: 300_000,
  });

  // ── Active plan → today's planned workout ───────────────────────────────
  const { data: activePlans } = useQuery<TrainingPlanSummary[]>({
    queryKey: ['training-plans', 'active'],
    queryFn: () => getTrainingPlans(authFetch, 'active'),
    staleTime: 60_000,
  });

  const activePlan = activePlans && activePlans.length > 0 ? activePlans[0] : null;

  const currentWeek = activePlan
    ? getCurrentWeek(activePlan.start_date, activePlan.end_date)
    : 0;

  const { data: planWeek, isLoading: planWeekLoading } = useQuery<TrainingWeekResponse>({
    queryKey: ['plan-week', activePlan?.id, currentWeek],
    queryFn: () => getPlanWeek(authFetch, activePlan!.id, currentWeek),
    staleTime: 60_000,
    enabled: !!activePlan,
  });

  const todayStr = toDateStr(new Date());
  const todayPlanDay: TrainingWeekDay | undefined = planWeek?.days.find(
    (d) => d.day_date === todayStr,
  );

  // ── Loading state ───────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => <SkeletonMetric key={i} />)}
        </div>
        <ListSkeleton count={3} />
      </div>
    );
  }

  if (!todaySummary) {
    return (
      <EmptyState
        icon="📅"
        title="No data for today"
        description="Start training to see your daily summary here."
      />
    );
  }

  // ── Upcoming events (today or next 2) ───────────────────────────────────
  const displayEvents = upcomingEvents?.slice(0, 2) ?? [];

  return (
    <div className="space-y-8">

      {/* ── Status Banners ──────────────────────────────────────────────────── */}
      {(summary?.rest_day_suggestion || displayEvents.length > 0) && (
        <div className="space-y-4">
          {summary?.rest_day_suggestion && (
            <RestDayBanner suggestion={summary.rest_day_suggestion} />
          )}
          {displayEvents.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {displayEvents.map((evt) => (
                <Link
                  key={evt.id}
                  href="/training"
                  className={`rounded-xl p-4 border block transition-colors hover:border-accent/40 ${
                    evt.is_in_taper
                      ? 'bg-purple-900/20 border-purple-500/30'
                      : 'bg-surface border-surface-light/50'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xl">
                      {evt.event_type === 'race' ? '🏁' : evt.event_type === 'ride' ? '🚴' : evt.event_type === 'lift' ? '🏋️' : '📌'}
                    </span>
                    <div>
                      <p className="text-white font-medium text-sm">{evt.name}</p>
                      <p className="text-xs text-muted">{evt.event_date}</p>
                    </div>
                  </div>
                  <p className="text-sm mt-2">
                    {evt.days_until === 0 ? (
                      <span className="text-accent font-bold">🎯 Today!</span>
                    ) : (
                      <span className="text-white">🎯 <strong>{evt.days_until}</strong> days away</span>
                    )}
                  </p>
                  {evt.is_in_taper && (
                    <p className="text-xs text-purple-300 mt-1">📉 Taper phase — reduce load</p>
                  )}
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Readiness & Health Strip ─────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {hasReadiness ? (
          <ReadinessIndicator
            recoveryScore={readiness!.recovery_score ?? undefined}
            readiness={readiness!.readiness}
            hrvMs={readiness!.hrv_ms ?? undefined}
            restingHr={readiness!.resting_hr ?? undefined}
            message={readiness!.message}
          />
        ) : (
          <MetricCard
            label="Recovery"
            value={todaySummary.latest_recovery != null ? `${todaySummary.latest_recovery.toFixed(0)}%` : '—'}
            subtitle={todaySummary.latest_hrv_ms != null ? `HRV: ${todaySummary.latest_hrv_ms.toFixed(0)}ms` : 'No data'}
            color={(todaySummary.latest_recovery ?? 0) >= 70 ? 'text-positive' : (todaySummary.latest_recovery ?? 0) >= 50 ? 'text-yellow-400' : 'text-warning'}
            icon="❤️"
          />
        )}
        {respiratoryRate ? (
          <RespiratoryRateCard data={respiratoryRate} />
        ) : (
          <MetricCard
            label="Sleep"
            value={todaySummary.latest_sleep_hours != null ? `${todaySummary.latest_sleep_hours.toFixed(1)}h` : '—'}
            subtitle="Last night"
            color={(todaySummary.latest_sleep_hours ?? 0) >= 7 ? 'text-positive' : (todaySummary.latest_sleep_hours ?? 0) >= 6 ? 'text-yellow-400' : 'text-warning'}
            icon="😴"
          />
        )}
        <MetricCard
          label="Strain"
          value={todaySummary.latest_strain != null ? todaySummary.latest_strain.toFixed(1) : '—'}
          subtitle="Whoop strain (0-21)"
          color={(todaySummary.latest_strain ?? 0) >= 14 ? 'text-warning' : (todaySummary.latest_strain ?? 0) >= 10 ? 'text-yellow-400' : 'text-positive'}
          icon="💪"
          tooltip="Whoop Strain (0-21) measures cardiovascular load. 0-9: low, 10-13: moderate, 14-17: high, 18+: all-out. Based on time in HR zones."
        />
        <MetricCard
          label="Active Alerts"
          value={todaySummary.active_alerts}
          subtitle="Health warnings"
          color={todaySummary.active_alerts > 0 ? 'text-warning' : 'text-positive'}
          icon="🔔"
          tooltip="Health alerts triggered by declining HRV, elevated respiratory rate, poor sleep, or other anomalies. Check the Weekly tab for details."
        />
      </div>

      {/* ── Today's Plan ────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>📋 Today&apos;s Plan</CardTitle>
        </CardHeader>
        {planWeekLoading ? (
          <div className="flex items-center gap-3 py-4">
            <div className="h-8 w-8 rounded bg-surface-light/50 animate-pulse" />
            <div className="space-y-2 flex-1">
              <div className="h-4 w-48 bg-surface-light/50 rounded animate-pulse" />
              <div className="h-3 w-32 bg-surface-light/50 rounded animate-pulse" />
            </div>
          </div>
        ) : todayPlanDay ? (
          <TodayPlanDay day={todayPlanDay} />
        ) : !activePlan ? (
          <div className="text-center py-6">
            <p className="text-3xl mb-2">📅</p>
            <p className="text-muted text-sm">No active training plan</p>
            <a href="/training" className="text-accent hover:text-accent-hover text-xs mt-1 inline-block">
              Create or activate a plan
            </a>
          </div>
        ) : (
          <div className="text-center py-6">
            <p className="text-3xl mb-2">😴</p>
            <p className="text-muted text-sm">Nothing planned for today</p>
          </div>
        )}
      </Card>

      {/* ── Today's Numbers ──────────────────────────────────────────────────── */}
      <div>
        <h2 className="text-sm font-medium text-muted uppercase tracking-wider mb-3">Today&apos;s Numbers</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCard
            label="TSS Today"
            value={todaySummary.today_tss > 0 ? todaySummary.today_tss.toFixed(0) : '—'}
            subtitle="Training Stress Score"
            color="text-blue-400"
            icon="⚡"
            tooltip="Training Stress Score — composite measure of workout difficulty based on intensity and duration. 100 TSS = 1 hour at FTP. Higher means harder."
          />
          <MetricCard
            label="Volume Today"
            value={todaySummary.today_volume_kg > 0 ? `${todaySummary.today_volume_kg.toLocaleString()} kg` : '—'}
            subtitle="Lifting volume"
            color="text-purple-400"
            icon="🏋️"
            tooltip="Total lifting volume (sets × reps × weight) for today. Track progressive overload by comparing week-to-week."
          />
          <MetricCard
            label="Distance"
            value={todaySummary.today_distance_meters > 0 ? formatDistance(todaySummary.today_distance_meters) : '—'}
            subtitle="Cardio distance"
            color="text-positive"
            icon="🚴"
            tooltip="Total distance from all cardio activities today (cycling, running, etc.)."
          />
          <MetricCard
            label="Duration"
            value={todaySummary.today_duration_seconds > 0 ? formatDuration(todaySummary.today_duration_seconds) : '—'}
            subtitle="Training time"
            color="text-muted"
            icon="⏱️"
            tooltip="Total elapsed time across all activities and lifting sessions today."
          />
        </div>
      </div>

      {/* ── Training Load (CTL / ATL / TSB) ─────────────────────────────────── */}
      <div>
        <h2 className="text-sm font-medium text-muted uppercase tracking-wider mb-3">Form Trend</h2>
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          <div className="lg:col-span-3">
            <Card>
              <ChartBody
                isLoading={trainingLoadLoading}
                data={trainingLoadChart}
                emptyMessage="No training load data available"
                height={260}
              />
            </Card>
          </div>
          <div className="grid grid-cols-3 lg:grid-cols-1 gap-4">
            <Link href="/cycling" className="block group">
              <MetricCard
                label="CTL (Fitness)"
                value={todaySummary.current_ctl.toFixed(1)}
                subtitle="42-day chronic load"
                color="text-blue-400"
                icon="📈"
                tooltip="Chronic Training Load — long-term fitness as a 42-day exponentially weighted average of TSS. Higher = fitter. Typical range: 30-150. Builds slowly over weeks."
              />
            </Link>
            <Link href="/cycling" className="block group">
              <MetricCard
                label="ATL (Fatigue)"
                value={todaySummary.current_atl.toFixed(1)}
                subtitle="7-day acute load"
                color="text-orange-400"
                icon="🔥"
                tooltip="Acute Training Load — short-term fatigue as a 7-day exponentially weighted average of TSS. Spikes after hard days, drops quickly with rest."
              />
            </Link>
            <Link href="/cycling" className="block group">
              <MetricCard
                label="TSB (Form)"
                value={todaySummary.current_tsb.toFixed(1)}
                subtitle={
                  todaySummary.current_tsb < -30 ? 'Overreaching'
                  : todaySummary.current_tsb < -10 ? 'Productive'
                  : todaySummary.current_tsb > 10 ? 'Fresh / Tapered'
                  : 'Neutral'
                }
                color={
                  todaySummary.current_tsb < -30 ? 'text-warning'
                  : todaySummary.current_tsb < -10 ? 'text-amber-400'
                  : todaySummary.current_tsb > 10 ? 'text-positive'
                  : 'text-blue-400'
                }
                icon="⚖️"
                tooltip="Training Stress Balance (Form) = CTL − ATL. Positive = fresh/rested (good for racing). Negative = fatigued (good for building fitness). Sweet spot: -10 to +10."
              />
            </Link>
          </div>
        </div>
      </div>

      {/* ── Today's Activities + Lifting ─────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Activities */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between w-full">
              <CardTitle>🚴 Today&apos;s Activities</CardTitle>
              <span className="text-xs text-muted">{todaySummary.today_activities.length}</span>
            </div>
          </CardHeader>
          {todaySummary.today_activities.length > 0 ? (
            <div className="space-y-2">
              {todaySummary.today_activities.map((a) => (
                <div key={a.id} className="flex items-center justify-between p-3 bg-surface-light/30 rounded-lg hover:bg-surface-light/50 transition-colors">
                  <div className="flex items-center gap-3 min-w-0">
                    <Badge variant={getSportBadgeVariant(a.sport_type)}>
                      {a.sport_type}
                    </Badge>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-white truncate">{a.name}</p>
                      <p className="text-xs text-muted">
                        {new Date(a.start_date).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                  <div className="text-right shrink-0 ml-3 flex items-center gap-4">
                    {a.tss != null && (
                      <p className="text-xs text-blue-400">{a.tss.toFixed(0)} TSS</p>
                    )}
                    {a.average_power != null && (
                      <p className="text-xs text-yellow-400">{a.average_power.toFixed(0)}W</p>
                    )}
                    {a.average_heartrate != null && (
                      <p className="text-xs text-warning">{a.average_heartrate.toFixed(0)} bpm</p>
                    )}
                    {a.distance_meters != null && !['weighttraining', 'workout', 'crossfit', 'strength_training'].includes(a.sport_type) && (
                      <p className="text-sm text-muted">{formatDistance(a.distance_meters)}</p>
                    )}
                    {a.duration_seconds != null && (
                      <p className="text-xs text-muted">{formatDuration(a.duration_seconds)}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <p className="text-3xl mb-2">🏃</p>
              <p className="text-muted text-sm">No activities today</p>
              <p className="text-muted text-xs mt-1">
                <a href="/activities" className="text-accent hover:text-accent-hover">View Activities</a>
              </p>
            </div>
          )}
        </Card>

        {/* Lifting */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between w-full">
              <CardTitle>🏋️ Today&apos;s Lifting</CardTitle>
              <span className="text-xs text-muted">{todaySummary.today_lifting_sessions.length}</span>
            </div>
          </CardHeader>
          {todaySummary.today_lifting_sessions.length > 0 ? (
            <div className="space-y-2">
              {todaySummary.today_lifting_sessions.map((s) => (
                <div key={s.id} className="flex items-center justify-between p-3 bg-surface-light/30 rounded-lg hover:bg-surface-light/50 transition-colors">
                  <div>
                    <p className="text-sm font-medium text-white">{s.focus || 'General'}</p>
                    <p className="text-xs text-muted">{s.sets_count} sets</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-purple-400">
                      {s.total_volume_kg.toLocaleString()} kg vol
                    </p>
                    {s.rpe_session != null && (
                      <p className="text-xs text-muted">RPE {s.rpe_session.toFixed(1)}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <p className="text-3xl mb-2">🏋️</p>
              <p className="text-muted text-sm">No lifting today</p>
              <a href="/lifting" className="text-accent hover:text-accent-hover text-xs mt-1 inline-block">
                Create Session
              </a>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

// ── Today's Plan Day Sub-component ────────────────────────────────────────

function TodayPlanDay({ day }: { day: TrainingWeekDay }) {
  const isDone = !!(day.actual_activity || day.actual_lifting_session || day.completed);
  const isRest = day.sport === 'rest';

  return (
    <div className="flex items-start gap-4">
      {/* Sport icon */}
      <div className="text-3xl">{SPORT_EMOJI[day.sport] ?? '🏃'}</div>

      {/* Main info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant={getSportBadgeVariant(day.sport === 'strength' ? 'weighttraining' : day.sport)}>
            {day.sport === 'strength' ? 'Strength' : day.sport === 'cycle' ? 'Cycling' : 'Rest'}
          </Badge>
          {day.planned_type && (
            <span className={`text-xs font-medium ${DAY_TYPE_COLORS[day.planned_type] ?? 'text-muted'}`}>
              {day.planned_type.charAt(0).toUpperCase() + day.planned_type.slice(1)}
            </span>
          )}
          {isDone && (
            <span className="text-xs font-medium text-positive">✓ Completed</span>
          )}
          {isRest && (
            <span className="text-xs font-medium text-gray-400">Recovery day</span>
          )}
        </div>

        {day.workout_description && (
          <p className="text-sm text-white mt-1">{day.workout_description}</p>
        )}

        {day.planned_focus && (
          <p className="text-xs text-muted mt-1">
            Focus: <span className="text-white">{day.planned_focus.replace(/_/g, ' ')}</span>
          </p>
        )}

        {/* Planned metrics */}
        {!isRest && (
          <div className="flex items-center gap-4 mt-2 text-xs">
            {day.planned_duration_min != null && (
              <span className="text-muted">⏱ {day.planned_duration_min} min</span>
            )}
            {day.planned_tss != null && (
              <span className="text-blue-400">⚡ {day.planned_tss} TSS</span>
            )}
            {day.planned_zone && (
              <span className="text-orange-400">🎯 {day.planned_zone}</span>
            )}
            {day.planned_rpe != null && (
              <span className="text-yellow-400">RPE {day.planned_rpe}</span>
            )}
            {day.planned_power_watts != null && (
              <span className="text-yellow-400">{day.planned_power_watts}W</span>
            )}
          </div>
        )}

        {/* Planned exercises for strength days */}
        {day.planned_exercises && day.planned_exercises.length > 0 && (
          <div className="mt-2 space-y-1">
            {day.planned_exercises.map((ex, i) => (
              <p key={i} className="text-xs text-muted">
                <span className="text-white">{ex.exercise}</span> — {ex.sets}×{ex.reps}
                {ex.weight_kg != null ? ` @ ${ex.weight_kg}kg` : ''}
                {ex.rpe != null ? ` RPE ${ex.rpe}` : ''}
              </p>
            ))}
          </div>
        )}
      </div>

      {/* Weather */}
      {day.weather && (
        <div className="text-right shrink-0">
          <span className="text-2xl">{weatherEmoji(day.weather.conditions)}</span>
          {day.weather.temp_max != null && (
            <p className="text-xs text-muted mt-1">{Math.round(day.weather.temp_max)}°C</p>
          )}
          {day.bad_weather && (
            <span className="inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
              ⚠ Weather
            </span>
          )}
        </div>
      )}

      {/* Actual activity summary */}
      {day.actual_activity && (
        <div className="shrink-0 text-right">
          <p className="text-xs text-positive font-medium">Done</p>
          {day.actual_activity.distance_meters != null && (
            <p className="text-xs text-muted">{(day.actual_activity.distance_meters / 1000).toFixed(1)} km</p>
          )}
          {day.actual_activity.duration_seconds != null && (
            <p className="text-xs text-muted">{Math.round(day.actual_activity.duration_seconds / 60)} min</p>
          )}
        </div>
      )}
    </div>
  );
}
