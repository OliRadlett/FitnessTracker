'use client';

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import type { MonthlySummaryItem, YearlySummary, ChartData } from '@/lib/api';
import { useAuthFetch } from '@/lib/api';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { ChartBody } from '@/components/charts/Chart';
import { SkeletonMetric } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { MetricCard } from './helpers';

interface MonthlyTabProps {
  monthlySummary: MonthlySummaryItem[] | undefined;
  isLoading: boolean;
  selectedYear: number;
  setSelectedYear: React.Dispatch<React.SetStateAction<number>>;
  currentYear: number;
  yearlySummary: YearlySummary | undefined;
  yearlyLoading: boolean;
}

export function MonthlyTab({
  monthlySummary,
  isLoading,
  selectedYear,
  setSelectedYear,
  currentYear,
  yearlySummary,
  yearlyLoading,
}: MonthlyTabProps) {
  const { authFetch } = useAuthFetch();

  const { data: sleepChart, isLoading: sleepLoading } = useQuery<ChartData>({
    queryKey: ['chart-sleep-consistency', 90],
    queryFn: () => authFetch<ChartData>('/api/v1/charts/sleep_consistency?days=90'),
    staleTime: 300_000,
  });

  const { data: restDayChart, isLoading: restDayLoading } = useQuery<ChartData>({
    queryKey: ['chart-rest-day-analysis', 90],
    queryFn: () => authFetch<ChartData>('/api/v1/charts/rest_day_analysis?days=90'),
    staleTime: 300_000,
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => <SkeletonMetric key={i} />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Monthly Summary Cards */}
      {monthlySummary && monthlySummary.length > 0 ? (
        <div>
          <h2 className="text-sm font-medium text-muted uppercase tracking-wider mb-3">Monthly Summary</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {monthlySummary.map((month, i) => {
              const prevMonth = i < monthlySummary.length - 1 ? monthlySummary[i + 1] : null;
              const tssTrend = prevMonth && prevMonth.total_tss > 0
                ? ((month.total_tss - prevMonth.total_tss) / prevMonth.total_tss * 100)
                : null;
              const volTrend = prevMonth && prevMonth.lifting_volume_kg > 0
                ? ((month.lifting_volume_kg - prevMonth.lifting_volume_kg) / prevMonth.lifting_volume_kg * 100)
                : null;
              return (
                <Card key={month.month}>
                  <CardHeader>
                    <div className="flex items-center justify-between w-full">
                      <CardTitle>{new Date(month.month + '-01').toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</CardTitle>
                      {month.pr_count > 0 && (
                        <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/20 text-yellow-400">
                          🏆 {month.pr_count} PR{month.pr_count > 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                  </CardHeader>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-xs text-muted">TSS</p>
                      <div className="flex items-center gap-1">
                        <p className="text-sm font-bold text-blue-400">{month.total_tss.toFixed(0)}</p>
                        {tssTrend !== null && (
                          <span className={`text-xs ${tssTrend > 5 ? 'text-positive' : tssTrend < -5 ? 'text-warning' : 'text-muted'}`}>
                            {tssTrend > 0 ? '↑' : tssTrend < 0 ? '↓' : '→'}
                          </span>
                        )}
                      </div>
                    </div>
                    <div>
                      <p className="text-xs text-muted">Lifting Volume</p>
                      <div className="flex items-center gap-1">
                        <p className="text-sm font-bold text-purple-400">{(month.lifting_volume_kg / 1000).toFixed(1)}k kg</p>
                        {volTrend !== null && (
                          <span className={`text-xs ${volTrend > 5 ? 'text-positive' : volTrend < -5 ? 'text-warning' : 'text-muted'}`}>
                            {volTrend > 0 ? '↑' : volTrend < 0 ? '↓' : '→'}
                          </span>
                        )}
                      </div>
                    </div>
                    <div>
                      <p className="text-xs text-muted">Distance</p>
                      <p className="text-sm font-bold text-green-400">{(month.total_distance_meters / 1000).toFixed(0)} km</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted">Time</p>
                      <p className="text-sm font-bold text-slate-300">{(month.total_time_seconds / 3600).toFixed(1)}h</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted">Sessions</p>
                      <p className="text-sm font-bold text-white">
                        {month.lifting_sessions + month.cardio_sessions}
                        <span className="text-xs text-muted ml-1">
                          ({month.lifting_sessions}🏋️ {month.cardio_sessions}🚴)
                        </span>
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted">Avg Recovery</p>
                      <p className={`text-sm font-bold ${
                        (month.avg_recovery ?? 0) >= 70 ? 'text-green-400'
                        : (month.avg_recovery ?? 0) >= 50 ? 'text-yellow-400'
                        : 'text-red-400'
                      }`}>
                        {month.avg_recovery?.toFixed(0) ?? '—'}%
                      </p>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      ) : (
        <EmptyState
          icon="📆"
          title="No monthly data yet"
          description="Complete some training sessions to see monthly summaries."
        />
      )}

      {/* Sleep & Recovery Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Sleep Consistency</CardTitle>
          </CardHeader>
          <ChartBody
            isLoading={sleepLoading}
            data={sleepChart}
            emptyMessage="No sleep data available. Sync Whoop to populate."
            height={280}
          />
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Rest Day Analysis</CardTitle>
          </CardHeader>
          <ChartBody
            isLoading={restDayLoading}
            data={restDayChart}
            emptyMessage="No rest day data available yet"
            height={280}
          />
        </Card>
      </div>

      {/* Yearly Summary */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-muted uppercase tracking-wider">
            {selectedYear} Year in Review
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSelectedYear((y) => y - 1)}
              className="px-2 py-1 text-xs bg-surface-light hover:bg-surface text-muted rounded-lg transition-colors"
            >
              ← {selectedYear - 1}
            </button>
            {selectedYear < currentYear && (
              <button
                onClick={() => setSelectedYear((y) => Math.min(y + 1, currentYear))}
                className="px-2 py-1 text-xs bg-surface-light hover:bg-surface text-muted rounded-lg transition-colors"
              >
                {selectedYear + 1} →
              </button>
            )}
            {selectedYear !== currentYear && (
              <button
                onClick={() => setSelectedYear(currentYear)}
                className="px-2 py-1 text-xs bg-accent/20 text-accent border border-accent/30 rounded-lg hover:bg-accent/30 transition-colors"
              >
                Current Year
              </button>
            )}
          </div>
        </div>

        {yearlyLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => <SkeletonMetric key={i} />)}
          </div>
        ) : yearlySummary ? (
          <div className="space-y-6">
            {/* Year-over-year comparison badges */}
            {yearlySummary.year_over_year && (
              <div className="flex flex-wrap gap-2">
                {[
                  { label: 'Activities', value: yearlySummary.year_over_year.activities_delta, pct: yearlySummary.year_over_year.activities_pct },
                  { label: 'TSS', value: Math.round(yearlySummary.year_over_year.tss_delta), pct: yearlySummary.year_over_year.tss_pct },
                  { label: 'Distance', value: Math.round(yearlySummary.year_over_year.distance_delta_m / 1000), pct: yearlySummary.year_over_year.distance_pct, unit: 'km' },
                  { label: 'Lifting Vol', value: Math.round(yearlySummary.year_over_year.lifting_volume_delta_kg / 1000), pct: yearlySummary.year_over_year.lifting_volume_pct, unit: 'k kg' },
                  { label: 'PRs', value: yearlySummary.year_over_year.prs_delta, pct: null },
                ].map((item) => (
                  <span
                    key={item.label}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium ${
                      (item.value ?? 0) > 0 ? 'bg-green-500/15 text-green-400 border border-green-500/20'
                      : (item.value ?? 0) < 0 ? 'bg-red-500/15 text-red-400 border border-red-500/20'
                      : 'bg-surface-light text-muted border border-surface-light'
                    }`}
                  >
                    {item.label}: {item.value > 0 ? '+' : ''}{item.value}{item.unit ? ` ${item.unit}` : ''}
                    {item.pct !== null && item.pct !== undefined && (
                      <span className="opacity-75">({item.pct > 0 ? '+' : ''}{item.pct.toFixed(0)}%)</span>
                    )}
                  </span>
                ))}
                <span className="text-xs text-muted self-center ml-1">vs {selectedYear - 1}</span>
              </div>
            )}

            {/* Year totals */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              <MetricCard label="Activities" value={yearlySummary.total_activities} subtitle="Cardio sessions" color="text-blue-400" icon="🚴" />
              <MetricCard label="Distance" value={`${(yearlySummary.total_distance_m / 1000).toFixed(0)} km`} subtitle="Total distance" color="text-green-400" icon="📏" />
              <MetricCard label="TSS" value={yearlySummary.total_tss.toFixed(0)} subtitle="Training Stress" color="text-accent" icon="⚡" />
              <MetricCard label="Lifting" value={`${yearlySummary.total_lifting_sessions}`} subtitle={`${(yearlySummary.total_lifting_volume_kg / 1000).toFixed(0)}k kg vol`} color="text-purple-400" icon="🏋️" />
              <MetricCard label="Time" value={`${(yearlySummary.total_time_s / 3600).toFixed(0)}h`} subtitle="Cardio hours" color="text-slate-300" icon="⏱️" />
              <MetricCard label="Recovery" value={yearlySummary.avg_recovery ? `${yearlySummary.avg_recovery.toFixed(0)}%` : '—'} subtitle={yearlySummary.avg_hrv_ms ? `HRV: ${yearlySummary.avg_hrv_ms.toFixed(0)}ms` : 'Avg recovery'} color={(yearlySummary.avg_recovery ?? 0) >= 70 ? 'text-green-400' : 'text-yellow-400'} icon="❤️" />
            </div>

            {/* Highlight cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {yearlySummary.highlights.best_month_tss && (
                <div className="bg-surface rounded-xl border border-surface-light/50 p-4">
                  <p className="text-xs font-medium text-muted uppercase tracking-wider mb-1">🏆 Best Month (TSS)</p>
                  <p className="text-lg font-bold text-yellow-400">
                    {new Date(yearlySummary.highlights.best_month_tss + '-01').toLocaleDateString(undefined, { month: 'long' })}
                  </p>
                  <p className="text-xs text-muted">{yearlySummary.highlights.best_month_tss_value.toFixed(0)} TSS</p>
                </div>
              )}
              <div className="bg-surface rounded-xl border border-surface-light/50 p-4">
                <p className="text-xs font-medium text-muted uppercase tracking-wider mb-1">🏅 Total PRs</p>
                <p className="text-lg font-bold text-orange-400">{yearlySummary.highlights.total_prs}</p>
                <p className="text-xs text-muted">Personal records set</p>
              </div>
              {yearlySummary.highlights.longest_ride && (
                <div className="bg-surface rounded-xl border border-surface-light/50 p-4">
                  <p className="text-xs font-medium text-muted uppercase tracking-wider mb-1">🚴 Longest Ride</p>
                  <p className="text-lg font-bold text-green-400">{yearlySummary.highlights.longest_ride.value} {yearlySummary.highlights.longest_ride.unit}</p>
                  <p className="text-xs text-muted truncate">{yearlySummary.highlights.longest_ride.name}</p>
                </div>
              )}
              {yearlySummary.highlights.heaviest_lift && (
                <div className="bg-surface rounded-xl border border-surface-light/50 p-4">
                  <p className="text-xs font-medium text-muted uppercase tracking-wider mb-1">🏋️ Heaviest Lift</p>
                  <p className="text-lg font-bold text-purple-400">{yearlySummary.highlights.heaviest_lift.value} {yearlySummary.highlights.heaviest_lift.unit}</p>
                  <p className="text-xs text-muted truncate">{yearlySummary.highlights.heaviest_lift.name}</p>
                </div>
              )}
            </div>

            {/* PR highlights table */}
            {yearlySummary.highlights.pr_highlights.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>🏅 PR Highlights</CardTitle>
                </CardHeader>
                <div className="space-y-2">
                  {yearlySummary.highlights.pr_highlights.map((pr, i) => (
                    <div key={i} className="flex items-center justify-between p-3 bg-surface-light/30 rounded-lg">
                      <div>
                        <p className="text-sm font-medium text-white">{pr.exercise_name}</p>
                        <p className="text-xs text-muted">
                          {pr.record_type} — {pr.weight_kg}kg × {pr.reps}
                          {pr.estimated_1rm && ` (1RM: ${pr.estimated_1rm.toFixed(1)}kg)`}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-muted">{new Date(pr.achieved_date).toLocaleDateString()}</p>
                        {pr.improvement_pct !== null && pr.improvement_pct !== undefined && (
                          <span className={`text-xs font-medium ${pr.improvement_pct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {pr.improvement_pct > 0 ? '+' : ''}{pr.improvement_pct}%
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </div>
        ) : (
          <Card>
            <div className="text-center py-8">
              <p className="text-3xl mb-2">📅</p>
              <p className="text-muted text-sm">No data for {selectedYear} yet</p>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
