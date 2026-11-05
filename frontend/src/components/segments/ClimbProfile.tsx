'use client';

import React from 'react';

const BANDS = [
  { max: 3, color: 'rgb(100 116 139)', label: 'under 3%' },
  { max: 5, color: 'rgb(16 185 129)', label: '3–5%' },
  { max: 7, color: 'rgb(245 158 11)', label: '5–7%' },
  { max: Infinity, color: 'rgb(239 68 68)', label: '7%+' },
] as const;

function gradientColor(g: number): string {
  return (BANDS.find((b) => g < b.max) ?? BANDS[BANDS.length - 1]).color;
}

const W = 320;

/**
 * The climb, drawn from the real profile (`[distance, elevation, gradient]`).
 * Autoscaled: the shape identifies the hill; the gradient bands and the
 * numeric stats carry steepness. The detail view shows elevation/distance
 * labels; a card is a 44 px identifier.
 */
export function ClimbProfile({
  points,
  height = 44,
  large = false,
  className = '',
}: {
  points: number[][];
  height?: number;
  large?: boolean;
  className?: string;
}) {
  if (!points || points.length < 2) {
    return (
      <div
        className={`flex items-center justify-center rounded bg-surface-light/30 text-xs text-muted ${className}`}
        style={{ height }}
      >
        No profile
      </div>
    );
  }

  const padTop = large ? 10 : 3;
  const padBottom = large ? 8 : 3;
  const maxD = points[points.length - 1][0] || 1;
  const elevs = points.map((p) => p[1]);
  const minE = Math.min(...elevs);
  const maxE = Math.max(...elevs);
  const span = Math.max(1, maxE - minE);

  const x = (d: number) => (d / maxD) * W;
  const y = (e: number) =>
    padTop + (1 - (e - minE) / span) * (height - padTop - padBottom);

  const area = `M0 ${height - padBottom} L${points
    .map((p) => `${x(p[0]).toFixed(1)} ${y(p[1]).toFixed(1)}`)
    .join(' L')} L${W} ${height - padBottom} Z`;

  return (
    <div className={className}>
      {large ? (
        <div className="mb-1 flex items-center justify-between text-xs text-muted tabular-nums">
          <span>{Math.round(maxE)} m</span>
          <span>{Math.round(maxE - minE)} m of climbing</span>
        </div>
      ) : null}
      <svg
        viewBox={`0 0 ${W} ${height}`}
        preserveAspectRatio="none"
        style={{ height }}
        className="w-full overflow-visible"
        role="img"
        aria-label={
          large
            ? `Elevation profile over ${(maxD / 1000).toFixed(1)} km, ${Math.round(maxE - minE)} metres of climbing`
            : 'Elevation profile'
        }
      >
        <path d={area} fill="rgb(148 163 184 / 0.10)" />
        {points.slice(1).map((b, i) => {
          const a = points[i];
          return (
            <path
              key={i}
              d={`M${x(a[0]).toFixed(1)} ${y(a[1]).toFixed(1)}L${x(b[0]).toFixed(1)} ${y(b[1]).toFixed(1)}`}
              stroke={gradientColor((a[2] + b[2]) / 2)}
              strokeWidth={large ? 2.4 : 1.6}
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
      </svg>
      {large ? (
        <div className="mt-1 flex items-center justify-between text-xs text-muted tabular-nums">
          <span>0 km</span>
          <span>{(maxD / 2000).toFixed(1)} km</span>
          <span>{(maxD / 1000).toFixed(1)} km</span>
        </div>
      ) : null}
    </div>
  );
}

export function GradientLegend({ className = '' }: { className?: string }) {
  return (
    <div
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted ${className}`}
    >
      {BANDS.map((b) => (
        <span key={b.label} className="inline-flex items-center gap-1.5">
          <span
            className="h-1.5 w-3 rounded-full"
            style={{ backgroundColor: b.color }}
          />
          {b.label}
        </span>
      ))}
    </div>
  );
}
