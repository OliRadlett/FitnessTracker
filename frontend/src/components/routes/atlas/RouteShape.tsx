'use client';

import { useMemo } from 'react';
import { shapeGeometry } from '@/lib/routeAtlas';

/**
 * Route silhouette, projected into a fixed viewBox. Drawing the shape before
 * the name is the core of the atlas: every route is recognisable at a glance.
 */
export function RouteShape({
  encoded,
  width,
  height,
  className,
  strokeWidth = 2,
  showEndpoints = true,
}: {
  encoded: string | null | undefined;
  width: number;
  height: number;
  className?: string;
  strokeWidth?: number;
  showEndpoints?: boolean;
}) {
  const geometry = useMemo(
    () => shapeGeometry(encoded, width, height, Math.max(4, Math.round(width * 0.06))),
    [encoded, width, height],
  );

  if (!geometry.usable) {
    return (
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        className={className}
        role="img"
        aria-label="No shape data for this route"
      >
        <rect
          x="1"
          y="1"
          width={width - 2}
          height={height - 2}
          rx="4"
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.25"
          strokeDasharray="3 3"
        />
        <text
          x={width / 2}
          y={height / 2 + 3}
          textAnchor="middle"
          fill="currentColor"
          fillOpacity="0.55"
          fontSize="9"
        >
          No shape
        </text>
      </svg>
    );
  }

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={className}
      role="img"
      aria-label="Route shape"
    >
      <path
        d={geometry.path}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      {showEndpoints && geometry.start && (
        <circle cx={geometry.start.x} cy={geometry.start.y} r={2.4} fill="currentColor" />
      )}
      {showEndpoints && geometry.end && (
        <circle
          cx={geometry.end.x}
          cy={geometry.end.y}
          r={2.2}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        />
      )}
    </svg>
  );
}
