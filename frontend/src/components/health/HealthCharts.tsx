'use client';

import React from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ChartData } from '@/lib/api';
import { fmtDay, fmtFull } from './healthView';

const AXIS = 'rgba(148,163,184,0.55)';
const GRID = 'rgba(255,255,255,0.05)';
const TOOLTIP = 'rgba(18,24,24,0.98)';

const TONE_COLOR: Record<string, string> = {
  positive: '#22c55e',
  caution: '#f59e0b',
  warning: '#ef4444',
  muted: '#94a3b8',
};

export function Sparkline({
  data,
  height = 28,
  tone = 'positive',
  className = '',
}: {
  data: (number | null)[];
  height?: number;
  tone?: 'positive' | 'caution' | 'warning' | 'muted';
  className?: string;
}) {
  const values = data.filter((v): v is number => v != null);
  if (values.length < 2) {
    return <div className={className} style={{ height }} aria-hidden="true" />;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * 100;
      const y = 100 - ((v - min) / span) * 100;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className={`w-full ${className}`}
      style={{ height }}
      aria-hidden="true"
    >
      <polyline
        points={points}
        fill="none"
        stroke={TONE_COLOR[tone]}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export function RecoveryRing({
  score,
  tone,
  caption,
}: {
  score: number | null;
  tone: 'positive' | 'caution' | 'warning' | 'muted';
  caption: string;
}) {
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const pct = score == null ? 0 : Math.max(0, Math.min(100, score)) / 100;
  return (
    <div className="relative h-[132px] w-[132px] shrink-0" role="img" aria-label={score == null ? 'No recovery score' : `Recovery ${score} percent`}>
      <svg viewBox="0 0 132 132" className="h-full w-full -rotate-90">
        <circle cx="66" cy="66" r={radius} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="9" />
        <circle
          cx="66"
          cy="66"
          r={radius}
          fill="none"
          stroke={TONE_COLOR[tone]}
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={`${circumference * pct} ${circumference}`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[44px] font-semibold leading-none tabular-nums text-foreground">
          {score == null ? '—' : score.toFixed(0)}
          {score != null && <span className="ml-0.5 text-lg font-normal text-muted">%</span>}
        </span>
        <span className="mt-1 text-xs uppercase tracking-[0.12em] text-muted">{caption}</span>
      </div>
    </div>
  );
}

export function HealthTrendChart({
  chart,
  days,
  primary,
  secondary,
  unit,
  height = 190,
  domain,
  zones,
  ticks,
  primaryColor,
  ariaLabel,
}: {
  chart: ChartData | undefined;
  days: number;
  primary: string;
  secondary?: string;
  unit: string;
  height?: number;
  domain?: [number, number];
  zones?: { from: number; to: number; tone: 'positive' | 'caution' | 'warning' }[];
  ticks?: number[];
  primaryColor?: string;
  ariaLabel: string;
}) {
  const labels = chart?.labels ?? [];
  const start = Math.max(0, labels.length - days);
  const series = (chart?.series ?? []).filter((s) => s.name === primary || s.name === secondary);
  const rows = labels.slice(start).map((label, i) => {
    const row: Record<string, string | number | null> = { x: label };
    for (const s of series) row[s.name] = s.data[start + i] ?? null;
    return row;
  });

  const values = series
    .find((s) => s.name === primary)
    ?.data.slice(start)
    .filter((v): v is number => v != null) ?? [];
  if (rows.length === 0 || values.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-xl border border-dashed border-white/[0.07] text-xs text-muted" style={{ height }}>
        No data in this window
      </div>
    );
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = Math.max((max - min) * 0.12, 1);
  const yDomain: [number, number] = domain ?? [Math.max(0, Math.floor(min - pad)), Math.ceil(max + pad)];
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - avg) ** 2, 0) / values.length;
  const sd = Math.sqrt(variance);

  const tickCount = days <= 30 ? 4 : 5;
  const interval = Math.max(0, Math.floor(rows.length / tickCount) - 1);

  return (
    <div role="img" aria-label={ariaLabel}>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 6, right: 28, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            {zones?.map((z) => (
              <ReferenceArea
                key={`${z.from}-${z.to}`}
                y1={z.from}
                y2={z.to}
                fill={TONE_COLOR[z.tone]}
                fillOpacity={0.055}
                stroke="none"
                ifOverflow="extendDomain"
              />
            ))}
            {!zones && (
              <ReferenceArea
                y1={Math.max(yDomain[0], avg - sd)}
                y2={Math.min(yDomain[1], avg + sd)}
                fill="rgba(148,163,184,0.09)"
                stroke="none"
                ifOverflow="extendDomain"
              />
            )}
            <XAxis
              dataKey="x"
              tick={{ fill: AXIS, fontSize: 12 }}
              axisLine={{ stroke: GRID }}
              tickLine={false}
              interval={interval}
              tickFormatter={(v: string) => fmtDay(v)}
              tickMargin={8}
              minTickGap={16}
            />
            <YAxis
              domain={yDomain}
              tick={{ fill: AXIS, fontSize: 12 }}
              axisLine={false}
              tickLine={false}
              width={38}
              tickCount={4}
              ticks={ticks}
              tickFormatter={(v: number) => `${Math.round(v)}`}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: TOOLTIP,
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 10,
                fontSize: 12,
                color: '#e6e6e6',
              }}
              labelStyle={{ color: '#94a3b8', marginBottom: 4 }}
              labelFormatter={(v) => fmtFull(String(v))}
              formatter={(value: unknown, name: unknown) => [
                typeof value === 'number' ? `${value.toFixed(1)} ${unit}` : '—',
                String(name),
              ]}
            />
            {series.map((s) => (
              <Line
                key={s.name}
                type="monotone"
                dataKey={s.name}
                stroke={s.name === primary ? (primaryColor ?? s.color ?? '#22c55e') : '#60a5fa'}
                strokeWidth={s.name === primary ? 2.2 : 1.6}
                strokeDasharray={s.name === primary ? undefined : '4 4'}
                dot={false}
                activeDot={{ r: 3 }}
                isAnimationActive={false}
                connectNulls
              />
            ))}
            {!zones && (
              <ReferenceLine y={avg} stroke="rgba(148,163,184,0.4)" strokeDasharray="3 3" />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
      {series.length > 1 && (
        <div className="mt-1 flex flex-wrap items-center gap-4 text-xs text-muted">
          {series.map((s) => (
            <span key={s.name} className="inline-flex items-center gap-1.5">
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: s.name === primary ? (primaryColor ?? s.color ?? '#22c55e') : '#60a5fa' }}
              />
              {s.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
