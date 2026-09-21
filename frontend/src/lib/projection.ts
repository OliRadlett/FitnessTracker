'use client';

// B-14 projection overlays — dashed forecast continuation lines on the FTP,
// VO2max, weight, and 1RM charts, driven by GET /projections/metric/{key}
// (history + 8-week regression projection_line).

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthFetch } from '@/lib/api';
import type { ChartData } from '@/lib/api';

export interface ProjectionPoint {
  date: string;
  value: number;
}

export interface MetricTrend {
  metric: string;
  current_value: number | null;
  trend: {
    slope_per_day: number;
    slope_per_week: number;
    r_squared: number;
    data_points: number;
  } | null;
  classification: string | null;
  history: ProjectionPoint[];
  projection_line: ProjectionPoint[];
}

/** Fetch a metric trend (history + projection) for a forecast overlay. */
export function useMetricProjection(metricKey: string, filterJson?: string) {
  const { authFetch, token } = useAuthFetch();
  const params = filterJson ? `?filter_json=${encodeURIComponent(filterJson)}` : '';
  return useQuery<MetricTrend>({
    queryKey: ['projection', metricKey, filterJson ?? ''],
    queryFn: () =>
      authFetch<MetricTrend>(`/api/v1/projections/metric/${metricKey}${params}`),
    staleTime: 30 * 60_000,
    enabled: !!token,
  });
}

/** One-liner for chart sites: merged ChartData + caption (either may be null). */
export function useForecastChart(
  base: ChartData | undefined,
  metricKey: string,
  seriesName: string,
  filterJson?: string,
) {
  const { data: trend } = useMetricProjection(metricKey, filterJson);
  const data = useMemo(
    () => (base && trend ? withProjection(base, trend, seriesName) : base),
    [base, trend, seriesName],
  );
  const caption = trend ? projectionCaption(trend) : null;
  return { data, caption };
}
export function projectionCaption(trend: MetricTrend): string | null {
  if (!trend.trend || trend.projection_line.length === 0) return null;
  const weeks = Math.max(1, Math.round(trend.trend.data_points / 2));
  return `Forecast based on last ~${weeks} weeks (R² ${trend.trend.r_squared.toFixed(2)})`;
}

/**
 * Merge a projection onto a base ChartData as a dashed series. Projection
 * dates matching base ISO labels align in place; later dates extend the axis.
 * The junction duplicates the last history value so the dashed line grows
 * continuously out of the solid one. Returns the base chart unchanged when
 * there is nothing to project.
 */
export function withProjection(
  base: ChartData,
  trend: MetricTrend | undefined,
  seriesName: string,
): ChartData {
  if (!trend || trend.projection_line.length === 0 || base.series.length === 0) {
    return base;
  }
  const baseLabels = base.labels ?? [];
  const extraLabels = trend.projection_line
    .map((p) => p.date)
    .filter((d) => !baseLabels.includes(d));
  const labels = [...baseLabels, ...extraLabels];
  const projByDate = new Map(trend.projection_line.map((p) => [p.date, p.value]));
  const historyByDate = new Map(trend.history.map((p) => [p.date, p.value]));

  // Junction continuity: anchor the dashed line to the last known value so
  // it grows out of the solid line instead of floating.
  const lastBase = baseLabels[baseLabels.length - 1];
  if (lastBase && !projByDate.has(lastBase)) {
    const anchor =
      historyByDate.get(lastBase) ??
      [...base.series[0].data].reverse().find((v) => v != null) ??
      null;
    if (anchor != null) projByDate.set(lastBase, anchor);
  }

  const series = base.series.map((s) => ({
    ...s,
    data: [...s.data, ...extraLabels.map(() => null)],
  }));

  const firstColor = base.series[0].color;
  const projData: (number | null)[] = labels.map(
    (label) => projByDate.get(label) ?? null,
  );

  return {
    ...base,
    labels,
    series: [
      ...series,
      { name: seriesName, data: projData, color: firstColor, dashed: true },
    ],
  };
}
