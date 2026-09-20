'use client';

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import type { MonthlySummaryItem, YearlySummary, ChartData } from '@/lib/api';
import { useAuthFetch } from '@/lib/api';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { ChartBody } from '@/components/charts/Chart';
import { SkeletonMetric } from '@/components/ui/Skeleton';
import { MonthlySummarySection, YearlySummarySection } from './PeriodSummaries';

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
  const { authFetch, token } = useAuthFetch();

  const { data: sleepChart, isLoading: sleepLoading } = useQuery<ChartData>({
    queryKey: ['chart-sleep-consistency', 90],
    queryFn: () => authFetch<ChartData>('/api/v1/charts/sleep_consistency?days=90'),
    staleTime: 300_000,
    enabled: !!token,
  });

  const { data: restDayChart, isLoading: restDayLoading } = useQuery<ChartData>({
    queryKey: ['chart-rest-day-analysis', 90],
    queryFn: () => authFetch<ChartData>('/api/v1/charts/rest_day_analysis?days=90'),
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
      {/* Monthly Summary Cards (shared section, BUG-041) */}
      <MonthlySummarySection monthlySummary={monthlySummary} showEmptyState />

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
