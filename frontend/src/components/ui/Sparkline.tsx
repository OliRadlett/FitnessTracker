'use client';

import React from 'react';

interface SparklineProps {
  /** Data points for the trend line. Null/undefined/NaN values are filtered out. */
  data: (number | null | undefined)[];
  /** Height of the sparkline in pixels. Default 24. */
  height?: number;
  /** Stroke color. Defaults to emerald accent via CSS variable. */
  color?: string;
  /** Fill area under the line. Defaults to false (line only). */
  area?: boolean;
  /** Extra class for the SVG element. */
  className?: string;
}

const VIRTUAL_WIDTH = 100;
const PADDING = 2;

/**
 * Micro chart: a compact inline SVG sparkline with a trend line.
 * Used inside MetricCard and JournalCard to show metric history.
 *
 * A1 design principle (stats sections): "one line of context per number."
 * A sparkline IS that context — a 24px-tall trend line next to a metric value.
 *
 * Renders line-only by default; `area={true}` adds a gradient fill from
 * the line colour down to transparent (used on LoadSummary for emphasis).
 *
 * Edge cases:
 * — Empty or <2 points: renders a muted dot or "no trend" text.
 * — Flat data (min === max): renders a flat line at vertical centre.
 */
export function Sparkline({
  data,
  height = 24,
  color = 'rgb(var(--accent))',
  area = false,
  className = '',
}: SparklineProps) {
  const points = React.useMemo(
    () => (data ?? []).filter((d): d is number => d != null && !Number.isNaN(d)),
    [data],
  );

  if (points.length < 2) {
    return (
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${VIRTUAL_WIDTH} ${height}`}
        preserveAspectRatio="none"
        className={className}
        aria-hidden={points.length === 0}
      >
        {points.length === 1 && (
          <circle
            cx={VIRTUAL_WIDTH / 2}
            cy={height / 2}
            r="2"
            fill="rgb(var(--muted))"
          />
        )}
      </svg>
    );
  }

  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;

  const polyPoints = points
    .map((d, i) => {
      const x = PADDING + (i / (points.length - 1)) * (VIRTUAL_WIDTH - 2 * PADDING);
      const y = height - PADDING - ((d - min) / range) * (height - 2 * PADDING);
      return `${x},${y}`;
    })
    .join(' ');

  // Build polygon for area fill (line + drop to bottom)
  const areaPoints =
    polyPoints +
    ` ${VIRTUAL_WIDTH - PADDING},${height - PADDING} ${PADDING},${height - PADDING}`;

  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 ${VIRTUAL_WIDTH} ${height}`}
      preserveAspectRatio="none"
      className={className}
      aria-hidden={true}
    >
      {area && (
        <defs>
          <linearGradient id="sparkline-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity={0.15} />
            <stop offset="1" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
      )}
      {area && (
        <polygon
          points={areaPoints}
          fill="url(#sparkline-area)"
        />
      )}
      <polyline
        points={polyPoints}
        fill="none"
        stroke={color}
        strokeWidth={area ? 1.5 : 1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
