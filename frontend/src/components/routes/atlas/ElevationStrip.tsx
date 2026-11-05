'use client';

import { useMemo } from 'react';
import type { RouteData } from '@/lib/api/types';
import { elevationGeometry } from '@/lib/routeAtlas';

/** Elevation profile strip. Handles both stored profile shapes. */
export function ElevationStrip({
  profile,
  width = 320,
  height = 56,
  className,
  showScale = false,
}: {
  profile: RouteData['elevation_profile'];
  width?: number;
  height?: number;
  className?: string;
  showScale?: boolean;
}) {
  const geometry = useMemo(
    () => elevationGeometry(profile, width, height),
    [profile, width, height],
  );

  if (!geometry.usable) {
    return (
      <div
        className={`flex items-center justify-center rounded-md border border-dashed border-surface-light/60 text-[11px] text-muted ${className ?? ''}`}
        style={{ height }}
      >
        No elevation data
      </div>
    );
  }

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height={height}
      preserveAspectRatio="none"
      className={className}
      role="img"
      aria-label="Elevation profile"
    >
      <path d={geometry.area} fill="currentColor" fillOpacity="0.14" />
      <path
        d={geometry.line}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      {showScale && (
        <>
          <text x="2" y="10" fill="currentColor" fillOpacity="0.6" fontSize="8">
            {Math.round(geometry.max)} m
          </text>
          <text x="2" y={height - 2} fill="currentColor" fillOpacity="0.6" fontSize="8">
            {Math.round(geometry.min)} m
          </text>
        </>
      )}
    </svg>
  );
}
