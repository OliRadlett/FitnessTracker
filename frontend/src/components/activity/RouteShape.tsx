'use client';

import React, { useMemo } from 'react';
import { niceScale, projectRoute } from '@/lib/route-shape';

/**
 * A route drawn as a shape, with a scale bar computed from the projection.
 *
 * No tiles: a basemap is a provider, a key and a cost decision, and the shape is
 * what a row and a detail page actually need. The projection is done per
 * breakpoint so the line fills the panel instead of shrinking into a letterbox.
 */
export function RouteShape({
  encoded,
  width,
  height,
  padding,
}: {
  encoded: string;
  width: number;
  height: number;
  padding: number;
}) {
  const route = useMemo(
    () => projectRoute(encoded, width, height, padding),
    [encoded, width, height, padding],
  );
  const scale = route ? niceScale(route.metresPerUnit, width * 0.18) : null;
  if (!route) return null;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="Route shape">
      {Array.from({ length: 9 }).map((_, i) => (
        <line
          key={`v${i}`}
          x1={(width / 8) * i}
          x2={(width / 8) * i}
          y1={0}
          y2={height}
          stroke="white"
          strokeOpacity={0.026}
          strokeWidth={1}
        />
      ))}
      {Array.from({ length: 5 }).map((_, i) => (
        <line
          key={`h${i}`}
          x1={0}
          x2={width}
          y1={(height / 4) * i}
          y2={(height / 4) * i}
          stroke="white"
          strokeOpacity={0.026}
          strokeWidth={1}
        />
      ))}
      <path
        d={route.path}
        fill="none"
        stroke="rgb(var(--accent))"
        strokeOpacity={0.14}
        strokeWidth={7}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d={route.path}
        fill="none"
        stroke="rgb(var(--accent))"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={route.start.x} cy={route.start.y} r={3.8} fill="rgb(var(--accent))" />
      <circle
        cx={route.end.x}
        cy={route.end.y}
        r={3.2}
        fill="rgb(var(--background))"
        stroke="rgb(var(--accent))"
        strokeWidth={1.5}
      />
      {scale && (
        <g transform={`translate(${width - padding - scale.units}, ${height - 18})`}>
          <line x1={0} x2={scale.units} y1={0} y2={0} stroke="rgb(var(--muted) / 0.4)" strokeWidth={1.2} />
          <line x1={0} x2={0} y1={-3} y2={3} stroke="rgb(var(--muted) / 0.4)" strokeWidth={1.2} />
          <line x1={scale.units} x2={scale.units} y1={-3} y2={3} stroke="rgb(var(--muted) / 0.4)" strokeWidth={1.2} />
          <text
            x={scale.units / 2}
            y={-7}
            textAnchor="middle"
            fill="rgb(var(--muted) / 0.5)"
            fontSize={9}
            fontFamily="Inter, sans-serif"
          >
            {scale.label}
          </text>
        </g>
      )}
    </svg>
  );
}
