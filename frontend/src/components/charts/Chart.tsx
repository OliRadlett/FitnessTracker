'use client';

import React from 'react';
import type { ChartData } from '@/lib/api';
import {
  ResponsiveContainer,
  LineChart, Line,
  BarChart, Bar,
  ScatterChart, Scatter,
  AreaChart, Area,
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ReferenceArea as RechartsReferenceArea,
  Brush,
} from 'recharts';

interface ChartProps {
  data: ChartData;
  height?: number;
  className?: string;
}

// Palette aligned with Tailwind theme tokens (accent/positive/warning/etc.)
const DEFAULT_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316'];

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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
 * Renders a chart body with built-in loading and empty states.
 * Use directly inside a Card when you need custom chrome around it.
 */
export function ChartBody({ isLoading, data, emptyMessage = 'No data available', height = 400, className = '' }: ChartFrameProps & { isLoading?: boolean; emptyMessage?: string }) {
  if (isLoading) {
    return (
      <div className={`h-80 flex items-center justify-center ${className}`} style={{ height }}>
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-accent" aria-label="Loading chart" />
      </div>
    );
  }
  if (!data || !hasData(data)) {
    return (
      <div className={`flex items-center justify-center text-muted text-sm ${className}`} style={{ height }}>
        {emptyMessage}
      </div>
    );
  }
  return <Chart data={data} height={height} className={className} />;
}

function renderReferenceAreas(areas?: { y1: number; y2: number; color?: string; opacity?: number; label?: string; y_axis?: string }[], yAxisId?: string) {
  if (!areas || areas.length === 0) return null;
  return areas.map((area, i) => (
    <RechartsReferenceArea
      key={`ref-area-${i}`}
      yAxisId={area.y_axis === 'right' ? 'right' : (yAxisId ?? area.y_axis)}
      y1={area.y1}
      y2={area.y2}
      fill={area.color || '#3b82f6'}
      fillOpacity={area.opacity ?? 0.08}
      label={area.label ? { value: area.label, position: 'insideTopLeft', fill: '#94a3b8', fontSize: 10 } : undefined}
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

  return (
    <div className="overflow-x-auto">
      <div className="flex gap-[3px]">
        <div className="flex flex-col gap-[3px] mr-1 text-[9px] text-muted justify-around">
          <span>M</span><span></span><span>W</span><span></span><span>F</span>
        </div>
        <div className="grid grid-rows-7 grid-flow-col gap-[3px]">
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
      <InsightsList insights={data.insights} />
    </div>
  );
}

function InsightsList({ insights }: { insights?: string[] }) {
  if (!insights || insights.length === 0) return null;
  return (
    <div className="mt-3 space-y-1">
      {insights.map((insight, i) => (
        <p key={i} className="text-xs text-slate-400 flex items-start gap-1.5">
          <span className="text-accent mt-0.5">💡</span>
          {insight}
        </p>
      ))}
    </div>
  );
}

export function Chart({ data, height = 400, className = '' }: ChartProps) {
  const chartData = formatSeriesForChart(data);
  const unit = extractUnit(data.y_label);
  const pointCount = (data.labels ?? []).length;
  const showDots = pointCount <= 30;
  const isDateAxis = (data.labels ?? []).length > 0 && ISO_DATE_RE.test(data.labels[0]);
  const hasRightAxis = data.series.some((s) => (s as { y_axis?: string }).y_axis === 'right');

  const commonAxisProps = {
    tick: { fill: '#94a3b8', fontSize: 12 },
    axisLine: { stroke: '#334155' },
    tickLine: { stroke: '#334155' },
  };

  const xAxisProps = {
    dataKey: 'x',
    tickFormatter: isDateAxis ? (v: string) => formatDateTick(v, pointCount) : undefined,
    label: data.x_label ? { value: data.x_label, position: 'insideBottom', offset: -5, fill: '#94a3b8' } : undefined,
    ...commonAxisProps,
  };

  const yAxisLeftProps = {
    ...commonAxisProps,
    yAxisId: 'left',
    label: data.y_label ? { value: data.y_label, angle: -90, position: 'insideLeft', fill: '#94a3b8' } : undefined,
  };

  const renderTooltip = () => (
    <Tooltip
      contentStyle={{
        backgroundColor: '#1e293b',
        border: '1px solid #334155',
        borderRadius: '8px',
        color: '#e2e8f0',
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
      <Legend wrapperStyle={{ color: '#94a3b8', fontSize: '12px' }} />
    ) : null;

  const renderBrush = () => {
    if (pointCount <= 20) return null;
    return (
      <Brush
        dataKey="x"
        height={30}
        stroke="#334155"
        fill="#1e293b"
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
      <div className={className} role="img" aria-label={data.title ? `${data.title} chart` : 'Chart'}>
        {data.title && <h4 className="text-sm font-medium text-muted mb-2">{data.title}</h4>}
        <HeatmapCalendar data={data} />
      </div>
    );
  }

  switch (data.chart_type) {
    case 'line':
      chartContent = (
        <ResponsiveContainer width="100%" height={height}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
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
              <Line
                key={s.name}
                yAxisId={(s as { y_axis?: string }).y_axis === 'right' ? 'right' : 'left'}
                type="monotone"
                dataKey={s.name}
                stroke={s.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length]}
                strokeWidth={2}
                dot={showDots ? { r: 3 } : false}
                activeDot={{ r: 5 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      );
      break;

    case 'bar':
      chartContent = (
        <ResponsiveContainer width="100%" height={height}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
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

    case 'scatter':
      chartContent = (
        <ResponsiveContainer width="100%" height={height}>
          <ScatterChart>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis dataKey="x" name={data.x_label || 'x'} type="number"
              label={data.x_label ? { value: data.x_label, position: 'insideBottom', offset: -5, fill: '#94a3b8' } : undefined}
              {...commonAxisProps} />
            <YAxis dataKey="y" name={data.y_label || 'y'} type="number"
              label={data.y_label ? { value: data.y_label, angle: -90, position: 'insideLeft', fill: '#94a3b8' } : undefined}
              {...commonAxisProps} />
            {renderReferenceAreas(data.reference_areas)}
            {renderTooltip()}
            {renderLegend()}
            {data.series.map((s, i) => (
              <Scatter
                key={s.name}
                name={s.name}
                data={(data.labels ?? []).map((label, j) => ({ x: Number(label), y: s.data[j] ?? 0 }))}
                fill={s.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length]}
              />
            ))}
          </ScatterChart>
        </ResponsiveContainer>
      );
      break;

    case 'area':
      chartContent = (
        <ResponsiveContainer width="100%" height={height}>
          <AreaChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
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
        <ResponsiveContainer width="100%" height={height}>
          <PieChart>
            {renderTooltip()}
            {renderLegend()}
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              outerRadius={Math.min(height * 0.35, 150)}
              dataKey="value"
              nameKey="name"
              label={({ name, percent }) => Number.isFinite(percent) ? `${name} ${(percent * 100).toFixed(0)}%` : name}
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
    <div className={className} role="img" aria-label={data.title ? `${data.title} chart` : 'Chart'}>
      {data.title && <h4 className="text-sm font-medium text-muted mb-2">{data.title}</h4>}
      {chartContent}
      <InsightsList insights={data.insights} />
    </div>
  );
}
