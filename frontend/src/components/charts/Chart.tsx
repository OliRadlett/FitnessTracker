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
} from 'recharts';

interface ChartProps {
  data: ChartData;
  height?: number;
  className?: string;
}

const DEFAULT_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316'];

function formatSeriesForChart(data: ChartData) {
  if (data.chart_type === 'pie') {
    const series = data.series[0];
    return (data.labels ?? []).map((label, i) => ({
      name: label,
      value: series?.data[i] ?? 0,
    }));
  }

  // Build chart data from labels + series data arrays
  const labels = data.labels ?? [];
  return labels.map((label, i) => {
    const point: Record<string, string | number> = { x: label };
    data.series.forEach((s) => {
      point[s.name] = s.data[i] ?? 0;
    });
    return point;
  });
}

function renderReferenceAreas(areas?: { y1: number; y2: number; color?: string; opacity?: number; label?: string }[]) {
  if (!areas || areas.length === 0) return null;
  return areas.map((area, i) => (
    <RechartsReferenceArea
      key={`ref-area-${i}`}
      y1={area.y1}
      y2={area.y2}
      fill={area.color || '#3b82f6'}
      fillOpacity={area.opacity ?? 0.08}
      label={area.label ? { value: area.label, position: 'insideTopLeft', fill: '#94a3b8', fontSize: 10 } : undefined}
    />
  ));
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

  const commonAxisProps = {
    tick: { fill: '#94a3b8', fontSize: 12 },
    axisLine: { stroke: '#334155' },
    tickLine: { stroke: '#334155' },
  };

  const renderTooltip = () => (
    <Tooltip
      contentStyle={{
        backgroundColor: '#1e293b',
        border: '1px solid #334155',
        borderRadius: '8px',
        color: '#e2e8f0',
      }}
    />
  );

  const renderLegend = () => (
    <Legend
      wrapperStyle={{ color: '#94a3b8', fontSize: '12px' }}
    />
  );

  let chartContent: React.ReactNode;

  switch (data.chart_type) {
    case 'line':
      chartContent = (
        <ResponsiveContainer width="100%" height={height}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis dataKey="x" label={data.x_label ? { value: data.x_label, position: 'insideBottom', offset: -5, fill: '#94a3b8' } : undefined} {...commonAxisProps} />
            <YAxis label={data.y_label ? { value: data.y_label, angle: -90, position: 'insideLeft', fill: '#94a3b8' } : undefined} {...commonAxisProps} />
            {renderReferenceAreas(data.reference_areas)}
            {renderTooltip()}
            {renderLegend()}
            {data.series.map((s, i) => (
              <Line
                key={s.name}
                type="monotone"
                dataKey={s.name}
                stroke={s.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length]}
                strokeWidth={2}
                dot={{ r: 3 }}
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
            <XAxis dataKey="x" label={data.x_label ? { value: data.x_label, position: 'insideBottom', offset: -5, fill: '#94a3b8' } : undefined} {...commonAxisProps} />
            <YAxis label={data.y_label ? { value: data.y_label, angle: -90, position: 'insideLeft', fill: '#94a3b8' } : undefined} {...commonAxisProps} />
            {renderTooltip()}
            {renderLegend()}
            {data.series.map((s, i) => (
              <Bar
                key={s.name}
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
            <XAxis dataKey="x" name={data.x_label || 'x'} type="number" {...commonAxisProps} />
            <YAxis dataKey="y" name={data.y_label || 'y'} type="number" {...commonAxisProps} />
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
            <XAxis dataKey="x" label={data.x_label ? { value: data.x_label, position: 'insideBottom', offset: -5, fill: '#94a3b8' } : undefined} {...commonAxisProps} />
            <YAxis label={data.y_label ? { value: data.y_label, angle: -90, position: 'insideLeft', fill: '#94a3b8' } : undefined} {...commonAxisProps} />
            {renderTooltip()}
            {renderLegend()}
            {data.series.map((s, i) => (
              <Area
                key={s.name}
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
              label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
            >
              {chartData.map((_, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={data.series[0]?.data[index] != null ? (data.series[0].color || DEFAULT_COLORS[index % DEFAULT_COLORS.length]) : DEFAULT_COLORS[index % DEFAULT_COLORS.length]}
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
    <div className={className}>
      {data.title && <h4 className="text-sm font-medium text-muted mb-2">{data.title}</h4>}
      {chartContent}
      <InsightsList insights={data.insights} />
    </div>
  );
}
