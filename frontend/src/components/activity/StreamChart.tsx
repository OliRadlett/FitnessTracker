'use client';

import React, { useMemo } from 'react';
import { seriesLine } from '@/lib/route-shape';

/**
 * Bucket a stream so a 10k-sample ride reads as a shape instead of aliased
 * noise, then smooth it: a 5-minute mean on a hilly ride still alternates
 * between a climb and a descent, which reads as noise rather than effort.
 */
export function bucketMeans(values: number[], buckets = 56): number[] {
  const out: number[] = [];
  const size = Math.max(1, Math.ceil(values.length / buckets));
  for (let i = 0; i < values.length; i += size) {
    const slice = values.slice(i, i + size).filter((value) => Number.isFinite(value));
    if (slice.length === 0) continue;
    out.push(slice.reduce((sum, value) => sum + value, 0) / slice.length);
  }
  return out;
}

export function rollingMean(values: number[], window = 4): number[] {
  if (values.length === 0) return [];
  const half = Math.floor(window / 2);
  return values.map((_, i) => {
    const slice = values.slice(Math.max(0, i - half), Math.min(values.length, i + half + 1));
    return slice.reduce((sum, value) => sum + value, 0) / slice.length;
  });
}

/** Power (area) and heart rate (hairline) across the ride. */
export function StreamChart({ watts, hr }: { watts: number[]; hr: number[] }) {
  const W = 820;
  const H = 172;

  const power = useMemo(() => rollingMean(bucketMeans(watts)), [watts]);
  const heart = useMemo(() => rollingMean(bucketMeans(hr), 6), [hr]);
  const powerLine = useMemo(() => seriesLine(power, W, H, 0, undefined, 8), [power]);
  const powerArea = powerLine ? `${powerLine} L${W} ${H} L0 ${H} Z` : '';
  const hrLine = useMemo(() => seriesLine(heart, W, H, undefined, undefined, 14), [heart]);

  const peak = Math.max(0, ...watts);
  const maxHr = Math.max(0, ...hr);
  const avgHr = heart.length ? heart.reduce((sum, value) => sum + value, 0) / heart.length : 0;

  return (
    <div>
      <div className="mb-2 flex items-center gap-4 text-[9.5px] uppercase tracking-[0.12em] text-muted/50">
        <span className="flex items-center gap-1.5">
          <span className="h-[2px] w-3 rounded bg-accent" /> Power
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-[2px] w-3 rounded bg-slate-500" /> Heart rate
        </span>
        <span className="ml-auto tabular-nums text-muted/35">peak {Math.round(peak)} W</span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-[172px] w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label="Power and heart rate over the ride"
      >
        {[0.2, 0.4, 0.6, 0.8].map((p) => (
          <line
            key={p}
            x1={0}
            x2={W}
            y1={H * p}
            y2={H * p}
            stroke="white"
            strokeOpacity={0.035}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <path d={powerArea} fill="rgb(var(--accent) / 0.09)" />
        <path
          d={powerLine}
          fill="none"
          stroke="rgb(var(--accent))"
          strokeWidth={1.3}
          strokeOpacity={0.95}
          vectorEffect="non-scaling-stroke"
        />
        <path
          d={hrLine}
          fill="none"
          stroke="rgb(var(--muted))"
          strokeWidth={1}
          strokeOpacity={0.65}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="mt-1.5 flex justify-between text-[9.5px] tabular-nums text-muted/35">
        <span>smoothed · {heart.length ? `${Math.round(avgHr)} bpm avg` : '—'}</span>
        <span>{Math.round(maxHr)} bpm peak · scales independent</span>
      </div>
    </div>
  );
}
