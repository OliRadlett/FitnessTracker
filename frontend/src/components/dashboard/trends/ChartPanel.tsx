'use client';

/**
 * A chart panel that draws a `ChartData` payload with Recharts directly.
 *
 * Why not the shared `Chart` component: it renders these payloads with every mark
 * squeezed into the left edge (weekly TSS, HRV) and with no series at all for the
 * form chart â€” the exact defect this page is meant to fix. Two of those were the
 * "empty axes" charts in the old dashboard. Rather than change a component five
 * other pages depend on, the dashboard draws its own three panels here, with the
 * three rules the page needs:
 *
 *   1. animation off, so a screenshot cannot catch a half-drawn series
 *   2. an explicit y-domain on every axis
 *   3. no series => an empty state, never bare axes
 */

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ChartData } from '@/lib/api';
import { Card } from '@/components/ui/Card';
import { ErrorState } from '@/components/ui/ErrorState';
import { SkeletonMetric } from '@/components/ui/Skeleton';

const GRID = 'rgba(255,255,255,0.06)';
const AXIS = 'rgb(148 163 184)';
const SERIES_COLORS = ['rgb(16 185 129)', 'rgb(239 68 68)', 'rgb(56 189 248)', 'rgb(167 139 250)'];

function toRows(data: ChartData) {
  return data.labels.map((label, i) => {
    const row: Record<string, string | number | null> = { x: label };
    for (const s of data.series) {
      const v = s.data?.[i];
      row[s.name] = typeof v === 'number' ? v : null;
    }
    return row;
  });
}

function tickFor(count: number) {
  return Math.max(0, Math.ceil(count / 6) - 1);
}

export function ChartPanel({
  title,
  data,
  isLoading,
  isError,
  onRetry,
  emptyMessage,
  emptyHint,
  height = 240,
  legend,
}: {
  title: string;
  data: ChartData | null | undefined;
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
  emptyMessage: string;
  emptyHint?: string;
  height?: number;
  legend?: React.ReactNode;
}) {
  const hasSeries =
    !!data && data.series.length > 0 && data.labels.length > 0 && data.series.some((s) => s.data?.length);

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[14px] font-medium text-foreground">{title}</h2>
        {legend}
      </div>

      {isLoading ? (
        <SkeletonMetric className="mt-3" />
      ) : isError ? (
        <div className="mt-3">
          <ErrorState variant="inline" show message="This chart could not load." onRetry={onRetry} />
        </div>
      ) : !hasSeries ? (
        <div className="mt-3 rounded-lg border border-dashed border-surface-light/60 px-3 py-6 text-center">
          <p className="text-[12px] text-muted">{emptyMessage}</p>
          {emptyHint && <p className="mt-1 text-[11px] text-muted/70">{emptyHint}</p>}
        </div>
      ) : (
        <div className="mt-3" style={{ height }}>
          <ResponsiveContainer width="100%" height="100%">
            {data!.chart_type === 'bar' ? (
              <BarChart data={toRows(data!)} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis
                  dataKey="x"
                  tick={{ fill: AXIS, fontSize: 10 }}
                  tickLine={false}
                  axisLine={{ stroke: GRID }}
                  interval={tickFor(data!.labels.length)}
                />
                <YAxis
                  tick={{ fill: AXIS, fontSize: 10 }}
                  tickLine={false}
                  axisLine={{ stroke: GRID }}
                  width={38}
                  domain={[0, 'auto']}
                  tickFormatter={(v: number) => Math.round(v).toString()}
                />
                <Tooltip contentStyle={TOOLTIP} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                {data!.series.length > 1 && !legend && <Legend iconSize={10} />}
                {data!.series.map((s, i) => (
                  <Bar
                    key={s.name}
                    dataKey={s.name}
                    fill={SERIES_COLORS[i % SERIES_COLORS.length]}
                    radius={[3, 3, 0, 0]}
                    isAnimationActive={false}
                    maxBarSize={26}
                  />
                ))}
              </BarChart>
            ) : (
              <LineChart data={toRows(data!)} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis
                  dataKey="x"
                  tick={{ fill: AXIS, fontSize: 10 }}
                  tickLine={false}
                  axisLine={{ stroke: GRID }}
                  interval={tickFor(data!.labels.length)}
                />
                <YAxis
                  tick={{ fill: AXIS, fontSize: 10 }}
                  tickLine={false}
                  axisLine={{ stroke: GRID }}
                  width={38}
                  domain={['auto', 'auto']}
                  tickFormatter={(v: number) => Math.round(v).toString()}
                />
                <Tooltip contentStyle={TOOLTIP} />
                {data!.series.length > 1 && !legend && <Legend iconSize={10} />}
                {data!.series.map((s, i) => (
                  <Line
                    key={s.name}
                    type="monotone"
                    dataKey={s.name}
                    stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
                    strokeWidth={1.5}
                    dot={false}
                    connectNulls
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            )}
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}

const TOOLTIP = {
  backgroundColor: 'rgb(18 24 24)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: '8px',
  color: 'rgb(230 230 230)',
  fontSize: 11,
} as const;
