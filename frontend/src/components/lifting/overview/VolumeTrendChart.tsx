'use client';

import React, { useEffect, useRef, useState } from 'react';
import { CHART_AXIS, CHART_GRID } from '@/components/charts/chartTheme';

const ACCENT = '#10b981';
const AMBER = '#f59e0b';

/** Measured-width SVG bar chart: keeps axis text at its real size on any card. */
export function VolumeTrendChart({
  labels,
  values,
  average,
  height = 170,
  max,
}: {
  labels: string[];
  values: number[];
  average?: number;
  height?: number;
  /** Optional fixed ceiling; defaults to the data's own maximum. */
  max?: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(560);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = entry?.contentRect.width;
      if (w && w > 0) setWidth(Math.round(w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const W = Math.max(280, width);
  const H = height;
  const padL = 38;
  const padR = 10;
  const padT = 18;
  const padB = 22;
  // A fixed 30 t ceiling clipped any heavier week. Scale to the data unless
  // the caller deliberately supplies a ceiling.
  const scaleMax = max ?? Math.max(1, ...values, average ?? 0) * 1.1;
  const y = (v: number) => H - padB - (v / scaleMax) * (H - padT - padB);
  const step = (W - padL - padR) / Math.max(1, labels.length);
  const bw = Math.min(34, step * 0.58);
  const ticks = [0, 0.5, 1].map((f) => f * scaleMax);

  return (
    <div ref={ref} className="w-full">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Weekly lifting volume">
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke={CHART_GRID} strokeDasharray="3 4" />
            <text x={padL - 8} y={y(t) + 3} textAnchor="end" fontSize={12} fill={CHART_AXIS}>
              {Math.round(t / 1000)}t
            </text>
          </g>
        ))}
        {values.map((v, i) => {
          const cx = padL + step * i + step / 2;
          const isLast = i === values.length - 1;
          return (
            <g key={labels[i]}>
              <rect
                x={cx - bw / 2}
                y={y(v)}
                width={bw}
                height={Math.max(2, H - padB - y(v))}
                rx={3}
                fill={isLast ? ACCENT : 'rgb(16 185 129 / 0.34)'}
              />
              {isLast && (
                <text x={cx} y={y(v) - 6} textAnchor="middle" fontSize={12} fill={CHART_AXIS} fontWeight={600}>
                  {(v / 1000).toFixed(0)}t
                </text>
              )}
              {i === 0 || i === Math.floor((labels.length - 1) / 2) || isLast ? (
                <text x={cx} y={H - 5} textAnchor="middle" fontSize={12} fill={CHART_AXIS}>
                  {labels[i]}
                </text>
              ) : null}
            </g>
          );
        })}
        {average != null && average > 0 && (
          <line x1={padL} x2={W - padR} y1={y(average)} y2={y(average)} stroke={AMBER} strokeWidth={1} strokeDasharray="4 4" />
        )}
      </svg>
    </div>
  );
}
