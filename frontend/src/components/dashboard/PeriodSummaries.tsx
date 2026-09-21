'use client';

// BUG-041: shared monthly/yearly summary rendering, extracted from the
// near-identical blocks in WeeklyTab and MonthlyTab. Both tabs consume these;
// tab-specific chrome (headings, empty states, extra charts) stays local.

import React from 'react';
import type { MonthlySummaryItem, YearlySummary } from '@/lib/api';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { SkeletonMetric } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { MetricCard } from '@/components/ui/MetricCard';

/** The six period props shared by WeeklyTab/MonthlyTab (BUG-040 grouping). */
export interface PeriodSummaryProps {
  monthlySummary: MonthlySummaryItem[] | undefined;
  selectedYear: number;
  setSelectedYear: React.Dispatch<React.SetStateAction<number>>;
  currentYear: number;
  yearlySummary: YearlySummary | undefined;
  yearlyLoading: boolean;
}

function MonthCard({ month, prevMonth }: { month: MonthlySummaryItem; prevMonth: MonthlySummaryItem | null }) {
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
          <p className="text-sm font-bold text-positive">{(month.total_distance_meters / 1000).toFixed(0)} km</p>
        </div>
        <div>
          <p className="text-xs text-muted">Time</p>
          <p className="text-sm font-bold text-muted">{(month.total_time_seconds / 3600).toFixed(1)}h</p>
        </div>
        <div>
          <p className="text-xs text-muted">Sessions</p>
          <p className="text-sm font-bold text-foreground">
            {month.lifting_sessions + month.cardio_sessions}
            <span className="text-xs text-muted ml-1">
              ({month.lifting_sessions}🏋️ {month.cardio_sessions}🚴)
            </span>
          </p>
        </div>
        <div>
          <p className="text-xs text-muted">Avg Recovery</p>
          <p className={`text-sm font-bold ${
            (month.avg_recovery ?? 0) >= 70 ? 'text-positive'
            : (month.avg_recovery ?? 0) >= 50 ? 'text-yellow-400'
            : 'text-warning'
          }`}>
            {month.avg_recovery?.toFixed(0) ?? '—'}%
          </p>
        </div>
      </div>
    </Card>
  );
}

export function MonthlySummarySection({
  monthlySummary,
  showEmptyState = false,
}: {
  monthlySummary: MonthlySummaryItem[] | undefined;
  /** MonthlyTab renders an EmptyState when empty; WeeklyTab renders nothing. */
  showEmptyState?: boolean;
}) {
  if (!monthlySummary || monthlySummary.length === 0) {
    if (!showEmptyState) return null;
    return (
      <EmptyState
        icon="📆"
        title="No monthly data yet"
        description="Complete some training sessions to see monthly summaries."
      />
    );
  }
  return (
    <div>
      <h2 className="text-sm font-medium text-muted uppercase tracking-wider mb-3">Monthly Summary</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {monthlySummary.map((month, i) => (
          <MonthCard
            key={month.month}
            month={month}
            prevMonth={i < monthlySummary.length - 1 ? monthlySummary[i + 1] : null}
          />
        ))}
      </div>
    </div>
  );
}

export function YearHeader({
  selectedYear,
  setSelectedYear,
  currentYear,
}: Pick<PeriodSummaryProps, 'selectedYear' | 'setSelectedYear' | 'currentYear'>) {
  return (
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
  );
}

export function YearOverYearBadges({
  yearlySummary,
  selectedYear,
}: Pick<PeriodSummaryProps, 'yearlySummary' | 'selectedYear'>) {
  if (!yearlySummary?.year_over_year) return null;
  const yoy = yearlySummary.year_over_year;
  return (
    <div className="flex flex-wrap gap-2">
      {[
        { label: 'Activities', value: yoy.activities_delta, pct: yoy.activities_pct },
        { label: 'TSS', value: Math.round(yoy.tss_delta), pct: yoy.tss_pct },
        { label: 'Distance', value: Math.round(yoy.distance_delta_m / 1000), pct: yoy.distance_pct, unit: 'km' },
        { label: 'Lifting Vol', value: Math.round(yoy.lifting_volume_delta_kg / 1000), pct: yoy.lifting_volume_pct, unit: 'k kg' },
        { label: 'PRs', value: yoy.prs_delta, pct: null },
      ].map((item) => (
        <span
          key={item.label}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium ${
            (item.value ?? 0) > 0 ? 'bg-green-500/15 text-positive border border-green-500/20'
            : (item.value ?? 0) < 0 ? 'bg-red-500/15 text-warning border border-red-500/20'
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
  );
}

export function YearTotalsGrid({ yearlySummary }: { yearlySummary: YearlySummary }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
      <MetricCard label="Activities" value={yearlySummary.total_activities} subtitle="Cardio sessions" color="text-blue-400" icon="🚴" />
      <MetricCard label="Distance" value={`${(yearlySummary.total_distance_m / 1000).toFixed(0)} km`} subtitle="Total distance" color="text-positive" icon="📏" />
      <MetricCard label="TSS" value={yearlySummary.total_tss.toFixed(0)} subtitle="Training Stress" color="text-accent" icon="⚡" />
      <MetricCard label="Lifting" value={`${yearlySummary.total_lifting_sessions}`} subtitle={`${(yearlySummary.total_lifting_volume_kg / 1000).toFixed(0)}k kg vol`} color="text-purple-400" icon="🏋️" />
      <MetricCard label="Time" value={`${(yearlySummary.total_time_s / 3600).toFixed(0)}h`} subtitle="Cardio hours" color="text-muted" icon="⏱️" />
      <MetricCard label="Recovery" value={yearlySummary.avg_recovery ? `${yearlySummary.avg_recovery.toFixed(0)}%` : '—'} subtitle={yearlySummary.avg_hrv_ms ? `HRV: ${yearlySummary.avg_hrv_ms.toFixed(0)}ms` : 'Avg recovery'} color={(yearlySummary.avg_recovery ?? 0) >= 70 ? 'text-positive' : 'text-yellow-400'} icon="❤️" />
    </div>
  );
}

export function YearHighlights({ yearlySummary }: { yearlySummary: YearlySummary }) {
  return (
    <>
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
            <p className="text-lg font-bold text-positive">{yearlySummary.highlights.longest_ride.value} {yearlySummary.highlights.longest_ride.unit}</p>
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

      {yearlySummary.highlights.pr_highlights.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>🏅 PR Highlights</CardTitle>
          </CardHeader>
          <div className="space-y-2">
            {yearlySummary.highlights.pr_highlights.map((pr, i) => (
              <div key={i} className="flex items-center justify-between p-3 bg-surface-light/30 rounded-lg">
                <div>
                  <p className="text-sm font-medium text-foreground">{pr.exercise_name}</p>
                  <p className="text-xs text-muted">
                    {pr.record_type} — {pr.weight_kg}kg × {pr.reps}
                    {pr.estimated_1rm && ` (1RM: ${pr.estimated_1rm.toFixed(1)}kg)`}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted">{new Date(pr.achieved_date).toLocaleDateString()}</p>
                  {pr.improvement_pct !== null && pr.improvement_pct !== undefined && (
                    <span className={`text-xs font-medium ${pr.improvement_pct >= 0 ? 'text-positive' : 'text-warning'}`}>
                      {pr.improvement_pct > 0 ? '+' : ''}{pr.improvement_pct}%
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </>
  );
}

function MonthlyBars({ yearlySummary }: { yearlySummary: YearlySummary }) {
  if (yearlySummary.months.length === 0) return null;
  const bar = (key: string, label: string, color: string, getVal: (m: YearlySummary['months'][number]) => number, fmt: (v: number) => string) => {
    const max = Math.max(...yearlySummary.months.map(getVal), 1);
    return (
      <Card>
        <CardHeader>
          <CardTitle>{label}</CardTitle>
        </CardHeader>
        <div className="flex items-end gap-1.5 h-32">
          {yearlySummary.months.map((m) => {
            const h = (getVal(m) / max) * 100;
            return (
              <div key={`${key}-${m.month}`} className="flex-1 flex flex-col items-center gap-1">
                <span className="text-[9px] text-muted">{getVal(m) > 0 ? fmt(getVal(m)) : ''}</span>
                <div className="w-full bg-surface-light/40 rounded-t" style={{ height: `${Math.max(h, 2)}%` }}>
                  <div className={`w-full h-full ${color} rounded-t`} />
                </div>
                <span className="text-[9px] text-muted">{m.month.slice(5)}</span>
              </div>
            );
          })}
        </div>
      </Card>
    );
  };
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {bar('tss', 'Monthly TSS', 'bg-blue-500/60', (m) => m.total_tss, (v) => String(Math.round(v)))}
      {bar('dist', 'Monthly Distance (km)', 'bg-green-500/60', (m) => m.total_distance_meters / 1000, (v) => String(Math.round(v)))}
      {bar('vol', 'Monthly Volume (k kg)', 'bg-purple-500/60', (m) => m.lifting_volume_kg / 1000, (v) => v.toFixed(1))}
    </div>
  );
}

export function YearlySummarySection({
  yearlySummary,
  yearlyLoading,
  selectedYear,
  setSelectedYear,
  currentYear,
  showBars = false,
}: PeriodSummaryProps & { showBars?: boolean }) {
  return (
    <div>
      <YearHeader selectedYear={selectedYear} setSelectedYear={setSelectedYear} currentYear={currentYear} />
      {yearlyLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => <SkeletonMetric key={i} />)}
        </div>
      ) : yearlySummary ? (
        <div className="space-y-6">
          <YearOverYearBadges yearlySummary={yearlySummary} selectedYear={selectedYear} />
          <YearTotalsGrid yearlySummary={yearlySummary} />
          <YearHighlights yearlySummary={yearlySummary} />
          {showBars && <MonthlyBars yearlySummary={yearlySummary} />}
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
  );
}
