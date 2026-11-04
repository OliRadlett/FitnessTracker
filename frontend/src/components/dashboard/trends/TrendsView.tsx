'use client';

/**
 * Trends — the review zone.
 *
 * One range control governs every panel. Three charts at rest, each with a title
 * that states what the data says rather than what the chart is called, and the
 * analyses collapsed underneath with their age on the outside.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChartPanel } from './ChartPanel';
import { AnalysisCard } from '@/components/analysis/AnalysisCard';
import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { SectionLabel } from '@/components/ui/SectionLabel';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { useAuthFetch } from '@/lib/api';
import type { ChartData, Goal } from '@/lib/api';
import type { DashboardPageData, DashboardRange } from '@/lib/dashboard/useDashboardPage';

const RANGE_OPTIONS = [
  { value: '7d' as const, label: '7D' },
  { value: '30d' as const, label: '30D' },
  { value: '90d' as const, label: '90D' },
  { value: 'ytd' as const, label: 'YTD' },
];

function meanValues(data: ChartData | null, seriesIndex = 0): number | null {
  const values = data?.series?.[seriesIndex]?.data;
  if (!values || values.length === 0) return null;
  const nums = values.filter((v): v is number => typeof v === 'number');
  if (nums.length === 0) return null;
  return nums.reduce((s, v) => s + v, 0) / nums.length;
}

function lastValue(data: ChartData | null, seriesIndex = 0): number | null {
  const values = data?.series?.[seriesIndex]?.data;
  if (!values || values.length === 0) return null;
  for (let i = values.length - 1; i >= 0; i--) {
    const v = values[i];
    if (typeof v === 'number') return v;
  }
  return null;
}

/** A chart title that carries the finding, not the metric name. */
function weeklyTakeaway(data: ChartData | null): string {
  const avg = meanValues(data);
  const last = lastValue(data);
  if (avg === null || last === null || avg === 0) return 'Weekly load';
  const pct = Math.round(((last - avg) / avg) * 100);
  return `Weekly load: ${Math.round(last)} TSS — ${Math.abs(pct)}% ${pct >= 0 ? 'above' : 'below'} the ${data?.labels.length ?? 0}-week average`;
}

function formTakeaway(data: ChartData | null): string {
  const values = data?.series?.[0]?.data ?? [];
  const first = values.find((v): v is number => typeof v === 'number');
  const last = lastValue(data);
  if (first === undefined || last === null || first === 0) return 'Form — fitness, fatigue and the gap';
  const pct = Math.round(((last - first) / first) * 100);
  return pct === 0
    ? 'Form — fitness flat across the window'
    : `Form — fitness ${pct > 0 ? 'up' : 'down'} ${Math.abs(pct)}% across the window`;
}

function goalLabel(g: Goal): string {
  if (g.metric === 'big3_total') return 'Big-3 total';
  const exercise = (g.filter_json as { exercise?: string } | null)?.exercise;
  return exercise ? `Est. 1RM · ${exercise}` : 'Estimated 1RM';
}

export function TrendsView({
  page,
  range,
  onRangeChange,
}: {
  page: DashboardPageData;
  range: DashboardRange;
  onRangeChange: (r: DashboardRange) => void;
}) {
  const { authFetch } = useAuthFetch();
  const queryClient = useQueryClient();

  const refresh = useMutation({
    mutationFn: () =>
      authFetch<unknown>('/api/v1/cycling/llm-analysis/on-demand', { method: 'POST' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['cycling', 'llm-analysis', 'latest'] });
    },
  });

  const { loadChart, weeklyTss, hrvChart, goals, cyclingAnalysis, healthAnalysis } = page.trends;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Trends"
        subtitle="One range governs every panel below."
        actions={
          <SegmentedControl
            options={RANGE_OPTIONS}
            value={range}
            onChange={onRangeChange}
            ariaLabel="Trends date range"
          />
        }
      />

      <ChartPanel
        title={formTakeaway(loadChart.data)}
        data={loadChart.data}
        isLoading={loadChart.state === 'loading'}
        isError={loadChart.state === 'error'}
        onRetry={loadChart.retry}
        emptyMessage="No training-load history yet"
        emptyHint="It builds as rides and sessions are recorded."
        legend={
          <span className="flex flex-wrap items-center gap-3 text-[10px] text-muted">
            <span className="flex items-center gap-1">
              <span aria-hidden className="h-[2px] w-4 bg-accent" /> fitness (CTL)
            </span>
            <span className="flex items-center gap-1">
              <span aria-hidden className="h-[2px] w-4 bg-warning" /> fatigue (ATL)
            </span>
            <span className="flex items-center gap-1">
              <span aria-hidden className="h-[2px] w-4 bg-info" /> form (TSB)
            </span>
          </span>
        }
        height={260}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartPanel
          title={weeklyTakeaway(weeklyTss.data)}
          data={weeklyTss.data}
          isLoading={weeklyTss.state === 'loading'}
          isError={weeklyTss.state === 'error'}
          onRetry={weeklyTss.retry}
          emptyMessage="No weekly load yet"
          emptyHint="Thirteen weeks of rides fill this in."
          height={220}
        />
        <ChartPanel
          title="Recovery — HRV behind the readiness score"
          data={hrvChart.data}
          isLoading={hrvChart.state === 'loading'}
          isError={hrvChart.state === 'error'}
          onRetry={hrvChart.retry}
          emptyMessage="No HRV history yet"
          emptyHint="Whoop sync brings this in."
          height={220}
        />
      </div>

      <Card className="p-5">
        <SectionLabel action={<span className="text-[11px] text-muted">target dates vary by goal</span>}>
          Goals — where the next PR comes from
        </SectionLabel>
        {goals.state === 'loading' ? (
          <p className="mt-2 text-[12px] text-muted">Loading goals…</p>
        ) : goals.state === 'empty' || !goals.data?.length ? (
          <p className="mt-2 text-[12px] text-muted">
            No goals set. A goal turns a number into a direction.
          </p>
        ) : (
          <div className="mt-3 grid gap-4 sm:grid-cols-3">
            {goals.data.map((g) => {
              const current = g.current_value ?? 0;
              const pct = Math.min(100, Math.round((current / (g.target_value || 1)) * 100));
              return (
                <div key={g.metric + (goalLabel(g) ?? '')}>
                  <div className="flex items-baseline justify-between">
                    <span className="text-[12px] text-foreground/90">{goalLabel(g)}</span>
                    <span className="text-[11px] tabular-nums text-muted">{pct}%</span>
                  </div>
                  <div className="mt-1.5 h-[3px] w-full overflow-hidden rounded-full bg-surface-light">
                    <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="mt-1 text-[11px] tabular-nums text-muted">
                    {current} / {g.target_value} kg
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card className="p-5">
        <SectionLabel action={<span className="text-[11px] text-muted">weekly job</span>}>Analysis</SectionLabel>
        <div className="mt-3 space-y-2">
          <AnalysisCard
            title="Performance analysis"
            analysis={cyclingAnalysis.data}
            onRefresh={() => refresh.mutate()}
            isRefreshing={refresh.isPending}
          />
          <AnalysisCard
            title="Health analysis"
            analysis={healthAnalysis.data}
            onRefresh={() => refresh.mutate()}
            isRefreshing={refresh.isPending}
          />
        </div>
      </Card>
    </div>
  );
}
