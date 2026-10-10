'use client';

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import type { MonthlySummaryItem, YearlySummary, ChartData } from '@/lib/api';
import { useAuthFetch } from '@/lib/api';
import { timeRangeDays, useTimeRange } from '@/lib/time-range';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { ChartBody } from '@/components/charts/Chart';
import { SkeletonMetric } from '@/components/ui/Skeleton';
import { MonthlySummarySection, YearlySummarySection } from './PeriodSummaries';
import { MonthNavigator, formatMonthKey } from './PeriodNav';

interface MonthlyTabProps {
  monthlySummary: MonthlySummaryItem[] | undefined;
  isLoading: boolean;
  selectedYear: number;
  setSelectedYear: React.Dispatch<React.SetStateAction<number>>;
  currentYear: number;
  yearlySummary: YearlySummary | undefined;
  yearlyLoading: boolean;
  onDownloadReport: (apiPath: string, filename: string) => void;
  /** Degraded state: `true` for a plain badge, string for badge detail. */
  stale?: boolean | string;
}

export function MonthlyTab({
  monthlySummary,
  isLoading,
  selectedYear,
  setSelectedYear,
  currentYear,
  yearlySummary,
  yearlyLoading,
  onDownloadReport,
  stale,
}: MonthlyTabProps) {
  const { authFetch, token } = useAuthFetch();

  /* Shared REVIEW time-range (ui-redesign-v2 §2.1): one picker drives every
     dashboard chart together (clamped to the backend `?days=` cap). */
  const { start: rangeStart, end: rangeEnd, preset: rangePreset } = useTimeRange();
  const chartDays = timeRangeDays(rangeStart, rangeEnd);

  /* Previous-period navigation (Walkthrough: history unreachable without it).
     The summary grid keeps all months (data maximalism); the navigator picks
     the focused month for the per-month PDF + card highlight. */
  const months = (monthlySummary ?? []).map((m) => m.month);
  const [focusedIndex, setFocusedIndex] = React.useState(0);
  const safeIndex = months.length === 0 ? 0 : Math.min(Math.max(focusedIndex, 0), months.length - 1);
  const focusedMonth = months.length === 0 ? null : months[safeIndex];

  const { data: sleepChart, isLoading: sleepLoading } = useQuery<ChartData>({
    queryKey: ['chart-sleep-consistency', chartDays],
    queryFn: () => authFetch<ChartData>(`/api/v1/charts/sleep_consistency?days=${chartDays}`),
    staleTime: 300_000,
    enabled: !!token,
  });

  const { data: restDayChart, isLoading: restDayLoading } = useQuery<ChartData>({
    queryKey: ['chart-rest-day-analysis', chartDays],
    queryFn: () => authFetch<ChartData>(`/api/v1/charts/rest_day_analysis?days=${chartDays}`),
    staleTime: 300_000,
    enabled: !!token,
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
      {/* Month history (Phase 2: prev/next month navigation) */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-muted uppercase tracking-wider">Month History</h2>
        <MonthNavigator months={months} focusedIndex={safeIndex} onChange={setFocusedIndex} />
      </div>
      {focusedMonth && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => onDownloadReport(
              `/api/v1/export/monthly-report/${focusedMonth}`,
              `fittrack_monthly_${focusedMonth}.pdf`,
            )}
            className="min-h-[44px] px-4 py-2 text-sm font-medium bg-surface-light hover:bg-surface text-foreground rounded-lg transition-colors border border-surface-light tabular-nums"
          >
            📄 Monthly Report (PDF · {formatMonthKey(focusedMonth)})
          </button>
        </div>
      )}

      {/* Monthly Summary Cards (shared section, BUG-041) */}
      <MonthlySummarySection monthlySummary={monthlySummary} showEmptyState focusedMonth={focusedMonth} />

      {/* Sleep & Recovery Charts (shared range — see caption) */}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium text-muted uppercase tracking-wider">Sleep &amp; Recovery</h2>
        <span className="text-xs text-muted tabular-nums">Shared range · {rangePreset}</span>
      </div>
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
            stale={stale}
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
            stale={stale}
          />
        </Card>
      </div>

      {/* Yearly Summary (shared section, BUG-041) */}
      <YearlySummarySection
        monthlySummary={monthlySummary}
        selectedYear={selectedYear}
        setSelectedYear={setSelectedYear}
        currentYear={currentYear}
        yearlySummary={yearlySummary}
        yearlyLoading={yearlyLoading}
      />
    </div>
  );
}
