'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import type { ChartData } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { BarChart3 } from 'lucide-react';
import {
  CHART_AXIS,
  CHART_GRID,
  CHART_SERIES_COLORS,
  CHART_TICK_STYLE,
  CHART_TOOLTIP_BG,
  CHART_TOOLTIP_BORDER,
  CHART_TOOLTIP_TEXT,
  CHART_FONT_BODY,
  CHART_ZONES,
  legendWrapperStyle,
  xAxisHeight,
  xTickAngle,
  xTickInterval,
} from './chartTheme';
import { ChartInsights } from './InsightCallout';
import {
  ResponsiveContainer,
  LineChart, Line,
  BarChart, Bar,
  ScatterChart, Scatter,
  AreaChart, Area,
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ReferenceArea as RechartsReferenceArea,
  ReferenceLine as RechartsReferenceLine,
  Brush,
} from 'recharts';

interface ChartProps {
  data: ChartData;
  height?: number;
  className?: string;
}

// Series palette lives in chartTheme (CHART_SERIES_COLORS) so every chart
// shares one set of dark-theme colors. Kept here as an alias for readability.
const DEFAULT_COLORS = CHART_SERIES_COLORS;

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True on phone-width viewports (<sm). Used to shrink chart chrome. */
function useNarrowScreen() {
  const [isNarrow, setIsNarrow] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(max-width: 639px)');
    const update = () => setIsNarrow(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return isNarrow;
}

/** Extract a unit suffix from a y-axis label, e.g. "Power (W)" -> " W". */
function extractUnit(yLabel?: string): string {
  if (!yLabel) return '';
  const match = yLabel.match(/\(([^)]+)\)/);
  return match ? ` ${match[1]}` : '';
}

/** Format an ISO date label for a compact axis tick. */
function formatDateTick(value: string, totalPoints: number): string {
  const match = ISO_DATE_RE.exec(value);
  if (!match) return value;
  const [, year, month, day] = match;
  if (totalPoints > 120) return `${MONTHS_SHORT[Number(month) - 1]} ${year.slice(2)}`;
  return `${MONTHS_SHORT[Number(month) - 1]} ${Number(day)}`;
}

/** Format an ISO date label in full for tooltip headers. */
function formatDateFull(value: string): string {
  const match = ISO_DATE_RE.exec(value);
  if (!match) return value;
  const [, year, month, day] = match;
  return `${MONTHS_SHORT[Number(month) - 1]} ${Number(day)}, ${year}`;
}

function hasData(data: ChartData): boolean {
  if (data.chart_type === 'pie') return (data.labels ?? []).length > 0;
  return (
    (data.labels ?? []).length > 0 &&
    data.series.some((s) => s.data.some((v) => v != null))
  );
}

function formatSeriesForChart(data: ChartData) {
  if (data.chart_type === 'pie') {
    const series = data.series[0];
    return (data.labels ?? []).map((label, i) => ({
      name: label,
      value: series?.data[i] ?? 0,
    }));
  }

  // Build chart data from labels + series data arrays.
  // Missing points become null (not 0): lines stop after their last real
  // value instead of plunging to zero, bars simply don't render.
  const labels = data.labels ?? [];
  return labels.map((label, i) => {
    const point: Record<string, string | number | null> = { x: label };
    data.series.forEach((s) => {
      point[s.name] = s.data[i] ?? null;
    });
    return point;
  });
}

interface ChartFrameProps {
  data?: ChartData | null;
  height?: number;
  className?: string;
}

/**
 * Primary action for a designed empty state (Honest Empty: what + how + CTA).
 * `href` navigates client-side; `onClick` runs a local action instead.
 */
export interface ChartEmptyAction {
  label: string;
  href?: string;
  onClick?: () => void;
}

/**
 * Stale-data badge (degraded state, pitfall 43): the chart still renders —
 * degradation is shown, never silently averaged away and never blank.
 */
export function StaleBadge({ detail }: { detail?: string }) {
  return (
    <span
      className="absolute top-0 right-0 z-10 inline-flex items-center gap-1.5 rounded-full border border-caution/40 bg-caution/10 px-2 py-0.5 text-xs text-caution"
      title={detail ?? 'This data may be out of date'}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-caution" aria-hidden="true" />
      Stale{detail ? ` · ${detail}` : ''}
    </span>
  );
}

/**
 * Renders a chart body with built-in loading, error, empty, and degraded
 * states. Every chart inherits the designed empty state (Honest Empty:
 * what + how-to-get-data + CTA) and the stale-data badge from here, so no
 * chart needs its own.
 *
 * Backward compatible: callers passing only `emptyMessage` (string or node)
 * get it rendered inside the designed shell with no further changes.
 */
export function ChartBody({ isLoading, isError, onRetry, data, emptyMessage = 'No data available', emptyHint, emptyAction, stale, height = 400, className = '' }: ChartFrameProps & {
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
  emptyMessage?: React.ReactNode;
  /** One line naming the path to data ("Sync Whoop to populate"). */
  emptyHint?: React.ReactNode;
  /** Primary CTA for the empty state. */
  emptyAction?: ChartEmptyAction;
  /** Degraded state: `true` for a plain badge, string for badge detail. */
  stale?: boolean | string;
}) {
  if (isLoading) {
    return (
      <div
        className={`${className}`}
        style={{ height }}
        role="status"
        aria-label="Loading chart"
      >
        <div className="flex h-full gap-2 rounded-xl bg-surface-light/20 p-4 animate-pulse" aria-hidden="true">
          <div className="w-8 shrink-0 rounded bg-surface-light/60" />
          <div className="flex flex-1 items-end gap-1.5">
            {[38, 62, 45, 74, 52, 84, 58, 40, 68, 48, 78, 56].map((h) => (
              <div key={h} className="flex-1 rounded-t bg-surface-light/60" style={{ height: `${h}%` }} />
            ))}
          </div>
        </div>
        <div className="mx-4 mt-2 h-3 rounded bg-surface-light/60 animate-pulse" aria-hidden="true" />
      </div>
    );
  }
  if (isError) {
    return (
      <div className={`flex flex-col items-center justify-center gap-2 text-center ${className}`} style={{ height }} role="alert">
        <p className="text-sm text-warning">Couldn&apos;t load this chart</p>
        {onRetry ? (
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Retry
          </Button>
        ) : null}
      </div>
    );
  }
  if (!data || !hasData(data)) {
    return (
      <div
        className={`flex flex-col items-center justify-center gap-1.5 px-6 text-center ${className}`}
        style={{ height }}
        role="status"
        aria-live="polite"
      >
        <BarChart3 className="w-6 h-6 text-muted" aria-hidden="true" />
        <p className="text-sm font-medium text-foreground">{emptyMessage}</p>
        {emptyHint ? <p className="text-xs text-muted max-w-sm">{emptyHint}</p> : null}
        {emptyAction ? (
          <div className="mt-2">
            {emptyAction.href ? (
              <Link
                href={emptyAction.href}
                className="inline-flex items-center px-4 py-2 text-sm font-medium bg-accent hover:bg-accent-hover text-white rounded-lg transition-colors"
              >
                {emptyAction.label}
              </Link>
            ) : (
              <Button variant="secondary" size="sm" onClick={emptyAction.onClick}>
                {emptyAction.label}
              </Button>
            )}
          </div>
        ) : null}
      </div>
    );
  }
  if (!stale) {
    return <Chart data={data} height={height} className={className} />;
  }
  return (
    <div className={`relative ${className}`}>
      <StaleBadge detail={typeof stale === 'string' ? stale : undefined} />
      <Chart data={data} height={height} />
    </div>
  );
}

function renderReferenceAreas(areas?: { y1: number; y2: number; color?: string; opacity?: number; label?: string; y_axis?: string }[], yAxisId?: string) {
  if (!areas || areas.length === 0) return null;
  return areas.map((area, i) => (
    <RechartsReferenceArea
      key={`ref-area-${i}`}
      yAxisId={area.y_axis === 'right' ? 'right' : (yAxisId ?? area.y_axis)}
      y1={area.y1}
      y2={area.y2}
      fill={area.color || CHART_SERIES_COLORS[0]}
      fillOpacity={area.opacity ?? 0.08}
      label={area.label ? { value: area.label, position: 'insideTopLeft', fill: CHART_AXIS, fontSize: CHART_FONT_BODY } : undefined}
    />
  ));
}

/**
 * Calendar heatmap for chart_type === "heatmap".
 * Labels are ISO dates, series[0].data the daily values.
 */
function HeatmapCalendar({ data }: { data: ChartData }) {
  const values = data.series[0]?.data ?? [];
  const max = Math.max(...values.map((v) => Number(v) || 0), 1);

  const colorFor = (v: number | null): string => {
    if (!v || v <= 0) return '#1e293b'; // empty cell
    const intensity = Math.min(Number(v) / max, 1);
    if (intensity < 0.25) return '#065f46';
    if (intensity < 0.5) return '#047857';
    if (intensity < 0.75) return '#059669';
    return '#10b981';
  };

  const cells = (data.labels ?? []).map((label, i) => {
    const date = new Date(`${label}T00:00:00`);
    const value = values[i] != null ? Number(values[i]) : null;
    return {
      label,
      weekday: date.getDay(),
      value,
      color: colorFor(value),
    };
  });

  const leadingBlanks = cells.length > 0 ? cells[0].weekday : 0;
  const activeDays = cells.filter((c) => (c.value ?? 0) > 0).length;
  const total = values.reduce<number>((sum, v) => sum + (Number(v) || 0), 0);

  return (
    <div className="overflow-x-auto">
      <div
        className="flex gap-[3px]"
        role="img"
        aria-label={`Activity heatmap: ${activeDays} active days, ${Math.round(total)} total`}
      >
        <div className="flex flex-col gap-[3px] mr-1 text-xs text-muted justify-around" aria-hidden="true">
          <span>M</span><span></span><span>W</span><span></span><span>F</span>
        </div>
        <div className="grid grid-rows-7 grid-flow-col gap-[3px]" aria-hidden="true">
          {Array.from({ length: leadingBlanks }).map((_, i) => (
            <div key={`blank-${i}`} className="w-3 h-3 rounded-sm" />
          ))}
          {cells.map((c) => (
            <div
              key={c.label}
              title={`${formatDateFull(c.label)}: ${c.value ?? 0}`}
              className="w-3 h-3 rounded-sm"
              style={{ backgroundColor: c.color }}
            />
          ))}
        </div>
      </div>
      <ChartInsights insights={data.insights} />
    </div>
  );
}

export function Chart({ data, height = 400, className = '' }: ChartProps) {
  const isNarrow = useNarrowScreen();
  // Cap tall charts on phones so one chart doesn't fill the whole screen
  const effectiveHeight = isNarrow ? Math.min(height, 280) : height;
  const chartData = formatSeriesForChart(data);
  const unit = extractUnit(data.y_label);
  const pointCount = (data.labels ?? []).length;
  const showDots = pointCount <= 30;
  const isDateAxis = (data.labels ?? []).length > 0 && ISO_DATE_RE.test(data.labels[0]);
  const hasRightAxis = data.series.some((s) => (s as { y_axis?: string }).y_axis === 'right');

  const commonAxisProps = {
    tick: { ...CHART_TICK_STYLE },
    axisLine: { stroke: CHART_GRID },
    tickLine: { stroke: CHART_GRID },
  };

  // Label culling: drop overlapping ticks (rotate on top when dense) — never
  // overlap (fixes the Form Trend complaint).
  const tickAngle = xTickAngle(pointCount);
  const xAxisProps = {
    dataKey: 'x',
    tickFormatter: isDateAxis ? (v: string) => formatDateTick(v, pointCount) : undefined,
    interval: xTickInterval(pointCount, isNarrow),
    angle: tickAngle,
    textAnchor: (tickAngle === 0 ? 'middle' : 'end') as 'middle' | 'end',
    height: xAxisHeight(pointCount),
    label: data.x_label ? { value: data.x_label, position: 'insideBottom', offset: -5, fill: CHART_AXIS } : undefined,
    ...commonAxisProps,
  };

  const yAxisLeftProps = {
    ...commonAxisProps,
    yAxisId: 'left',
    label: data.y_label ? { value: data.y_label, angle: -90, position: 'insideLeft', fill: CHART_AXIS } : undefined,
  };

  const renderTooltip = () => (
    <Tooltip
      contentStyle={{
        backgroundColor: CHART_TOOLTIP_BG,
        border: `1px solid ${CHART_TOOLTIP_BORDER}`,
        borderRadius: '8px',
        color: CHART_TOOLTIP_TEXT,
        fontSize: CHART_FONT_BODY,
      }}
      labelFormatter={isDateAxis ? (v) => formatDateFull(String(v ?? '')) : undefined}
      formatter={(value: unknown, name: unknown) => [
        typeof value === 'number' ? `${value.toLocaleString()}${unit}` : String(value),
        String(name),
      ]}
    />
  );

  const renderLegend = () =>
    data.series.length > 1 ? (
      <Legend iconSize={10} wrapperStyle={{ ...legendWrapperStyle(isNarrow) }} />
    ) : null;

  const renderBrush = () => {
    if (pointCount <= 20) return null;
    return (
      <Brush
        dataKey="x"
        height={isNarrow ? 32 : 30}
        travellerWidth={isNarrow ? 20 : 10}
        stroke={CHART_GRID}
        fill={CHART_TOOLTIP_BG}
        ariaLabel="Zoom range"
        startIndex={0}
        endIndex={Math.max(pointCount - 1, 0)}
        tickFormatter={isDateAxis ? (v: string) => formatDateTick(v, pointCount) : undefined}
      />
    );
  };

  let chartContent: React.ReactNode;

  if (data.chart_type === 'heatmap') {
    return (
      <div className={`tnum ${className}`} role="img" aria-label={data.title ? `${data.title} chart` : 'Chart'}>
        {data.title && <h4 className="text-sm font-medium text-muted mb-2">{data.title}</h4>}
        <HeatmapCalendar data={data} />
      </div>
    );
  }

  switch (data.chart_type) {
    case 'line':
      chartContent = (
        <ResponsiveContainer width="100%" height={effectiveHeight}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
            <XAxis {...xAxisProps} />
            <YAxis {...yAxisLeftProps} />
            {hasRightAxis && (
              <YAxis yAxisId="right" orientation="right" {...commonAxisProps} />
            )}
            {renderReferenceAreas(data.reference_areas, 'left')}
            {data.reference_line && (
              <RechartsReferenceLine
                yAxisId="left"
                x={data.reference_line.x}
                stroke={data.reference_line.color ?? CHART_ZONES.info}
                strokeDasharray="4 2"
                label={
                  data.reference_line.label
                    ? { value: data.reference_line.label, position: 'insideTopRight', fill: CHART_ZONES.info, fontSize: CHART_FONT_BODY }
                    : undefined
                }
              />
            )}
            {renderBrush()}
            {renderTooltip()}
            {renderLegend()}
            {data.series.map((s, i) => (
              <Line
                key={s.name}
                yAxisId={(s as { y_axis?: string }).y_axis === 'right' ? 'right' : 'left'}
                type="monotone"
                dataKey={s.name}
                stroke={s.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length]}
                strokeWidth={2}
                strokeDasharray={(s as { dashed?: boolean }).dashed ? '6 4' : undefined}
                dot={(s as { dashed?: boolean }).dashed ? false : showDots ? { r: 3 } : false}
                activeDot={{ r: 5 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      );
      break;

    case 'bar':
      chartContent = (
        <ResponsiveContainer width="100%" height={effectiveHeight}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
            <XAxis {...xAxisProps} />
            <YAxis {...yAxisLeftProps} />
            {hasRightAxis && (
              <YAxis yAxisId="right" orientation="right" {...commonAxisProps} />
            )}
            {renderReferenceAreas(data.reference_areas, 'left')}
            {renderTooltip()}
            {renderLegend()}
            {data.series.map((s, i) => (
              <Bar
                key={s.name}
                yAxisId={(s as { y_axis?: string }).y_axis === 'right' ? 'right' : 'left'}
                dataKey={s.name}
                fill={s.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length]}
                radius={[4, 4, 0, 0]}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      );
      break;

    case 'scatter': {
      const scatterLabels = data.labels ?? [];
      // Scatter axes are numeric. Date labels (e.g. decoupling trend) would
      // otherwise become Number("2026-08-20") -> NaN. Map them to timestamps.
      const scatterIsDate = scatterLabels.length > 0 && ISO_DATE_RE.test(scatterLabels[0]);
      const toScatterX = (label: string) =>
        scatterIsDate ? new Date(`${label}T00:00:00`).getTime() : Number(label);
      const formatScatterTick = (v: number) => {
        const d = new Date(v);
        const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        return formatDateTick(iso, scatterLabels.length);
      };
      chartContent = (
        <ResponsiveContainer width="100%" height={effectiveHeight}>
          <ScatterChart>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
            <XAxis dataKey="x" name={data.x_label || 'x'} type="number"
              tickFormatter={scatterIsDate ? formatScatterTick : undefined}
              minTickGap={24}
              label={data.x_label ? { value: data.x_label, position: 'insideBottom', offset: -5, fill: CHART_AXIS } : undefined}
              {...commonAxisProps} />
            <YAxis dataKey="y" name={data.y_label || 'y'} type="number"
              label={data.y_label ? { value: data.y_label, angle: -90, position: 'insideLeft', fill: CHART_AXIS } : undefined}
              {...commonAxisProps} />
            {renderReferenceAreas(data.reference_areas)}
            {renderTooltip()}
            {renderLegend()}
            {data.series.map((s, i) => (
              <Scatter
                key={s.name}
                name={s.name}
                data={scatterLabels.map((label, j) => ({ x: toScatterX(label), y: s.data[j] ?? 0 }))}
                fill={s.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length]}
              />
            ))}
          </ScatterChart>
        </ResponsiveContainer>
      );
      break;
    }

    case 'area':
      chartContent = (
        <ResponsiveContainer width="100%" height={effectiveHeight}>
          <AreaChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
            <XAxis {...xAxisProps} />
            <YAxis {...yAxisLeftProps} />
            {hasRightAxis && (
              <YAxis yAxisId="right" orientation="right" {...commonAxisProps} />
            )}
            {renderReferenceAreas(data.reference_areas, 'left')}
            {renderBrush()}
            {renderTooltip()}
            {renderLegend()}
            {data.series.map((s, i) => (
              <Area
                key={s.name}
                yAxisId={(s as { y_axis?: string }).y_axis === 'right' ? 'right' : 'left'}
                type="monotone"
                dataKey={s.name}
                stroke={s.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length]}
                fill={s.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length]}
                fillOpacity={0.15}
                strokeWidth={2}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      );
      break;

    case 'pie':
      chartContent = (
        <ResponsiveContainer width="100%" height={effectiveHeight}>
          <PieChart>
            {renderTooltip()}
            {renderLegend()}
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              outerRadius={Math.min(effectiveHeight * 0.35, 150)}
              dataKey="value"
              nameKey="name"
              // Slice labels clip on narrow screens — the legend carries the names there
              label={isNarrow ? false : ({ name, percent }) => Number.isFinite(percent) ? `${name} ${(percent * 100).toFixed(0)}%` : name}
            >
              {chartData.map((_, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={DEFAULT_COLORS[index % DEFAULT_COLORS.length]}
                />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      );
      break;

    default:
      return (
        <div className={`text-muted text-center py-8 ${className}`}>
          Unsupported chart type: {data.chart_type}
        </div>
      );
  }

  return (
    <div className={`tnum ${className}`} role="img" aria-label={data.title ? `${data.title} chart` : 'Chart'}>
      {data.title && <h4 className="text-sm font-medium text-muted mb-2">{data.title}</h4>}
      {chartContent}
      <ChartInsights insights={data.insights} />
    </div>
  );
}
