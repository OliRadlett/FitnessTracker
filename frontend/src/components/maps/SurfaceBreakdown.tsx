'use client';

import React from 'react';

interface SurfaceBreakdownProps {
  surfaceProfile: Record<string, number>;
  className?: string;
}

/**
 * Color mapping for terrain surface types.
 * Uses muted earth tones that fit the dark theme.
 */
const SURFACE_COLORS: Record<string, string> = {
  asphalt: '#6b7280',      // gray
  paved: '#6b7280',
  concrete: '#9ca3af',     // light gray
  gravel: '#92400e',       // brown
  compacted_gravel: '#92400e',
  fine_gravel: '#a16207',
  cobblestone: '#a16207',  // amber
  singletrack: '#15803d',  // green
  trail: '#15803d',
  dirt: '#854d0e',
  sand: '#d97706',         // orange
  grass: '#16a34a',
  wood: '#78350f',
  rock: '#57534e',
  unknown: '#4b5563',      // dark gray
};

const DEFAULT_COLOR = '#4b5563';

function getSurfaceColor(surface: string): string {
  const normalized = surface.toLowerCase().replace(/[\s-]/g, '_');
  return SURFACE_COLORS[normalized] || SURFACE_COLORS[surface.toLowerCase()] || DEFAULT_COLOR;
}

function formatLabel(surface: string): string {
  return surface
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Stacked horizontal bar showing terrain surface type percentages.
 *
 * Displays a color-coded bar with labels and percentages below.
 * Only renders when surfaceProfile has data.
 */
export function SurfaceBreakdown({ surfaceProfile, className = '' }: SurfaceBreakdownProps) {
  if (!surfaceProfile || Object.keys(surfaceProfile).length === 0) return null;

  // Sort by percentage descending, filter out zeros
  const entries = Object.entries(surfaceProfile)
    .filter(([, pct]) => pct > 0)
    .sort(([, a], [, b]) => b - a);

  if (entries.length === 0) return null;

  return (
    <div className={className}>
      <h4 className="text-xs text-muted mb-2 uppercase tracking-wider">Surface</h4>

      {/* Stacked bar */}
      <div className="flex h-4 rounded-full overflow-hidden mb-2">
        {entries.map(([surface, pct]) => (
          <div
            key={surface}
            style={{
              width: `${Math.max(pct * 100, 1)}%`,
              backgroundColor: getSurfaceColor(surface),
            }}
            title={`${formatLabel(surface)}: ${(pct * 100).toFixed(0)}%`}
          />
        ))}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {entries.map(([surface, pct]) => (
          <div key={surface} className="flex items-center gap-1.5 text-xs text-muted">
            <span
              className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: getSurfaceColor(surface) }}
            />
            <span>{formatLabel(surface)}</span>
            <span className="text-muted/60">{(pct * 100).toFixed(0)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
