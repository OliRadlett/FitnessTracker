'use client';

import React, { useMemo } from 'react';
import { projectRoute } from '@/lib/route-shape';
import type { SessionGlyph as Glyph } from '@/lib/journal';

/**
 * The row's identity mark. A ride is drawn as its actual shape (the encoded
 * polyline is already in the list payload); a lift is drawn as its heaviest
 * sets. A session with no shape gets a deliberately empty mark rather than a
 * sport icon that pretends to know something.
 */
export function SessionGlyph({ glyph, size = 44 }: { glyph: Glyph; size?: number }) {
  const route = useMemo(
    () => (glyph.kind === 'route' ? projectRoute(glyph.polyline, size, size, 7) : null),
    [glyph, size],
  );

  if (glyph.kind === 'route' && route) {
    return (
      <span
        className="flex shrink-0 items-center justify-center rounded-[9px] bg-white/[0.025] ring-1 ring-inset ring-white/[0.05]"
        style={{ width: size, height: size }}
        aria-hidden
      >
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none">
          <path
            d={route.path}
            stroke="rgb(var(--accent))"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={0.85}
          />
          <circle cx={route.start.x} cy={route.start.y} r={1.9} fill="rgb(var(--accent))" />
          <circle
            cx={route.end.x}
            cy={route.end.y}
            r={1.6}
            fill="rgb(var(--background))"
            stroke="rgb(var(--accent))"
            strokeWidth={1.2}
          />
        </svg>
      </span>
    );
  }

  if (glyph.kind === 'lift' && glyph.weights.length > 0) {
    const weights = glyph.weights.slice(-4);
    const max = Math.max(...weights, 1);
    const barWidth = 4.4;
    const gap = 3.4;
    const totalWidth = weights.length * barWidth + (weights.length - 1) * gap;
    return (
      <span
        className="flex shrink-0 items-center justify-center rounded-[9px] bg-white/[0.025] ring-1 ring-inset ring-white/[0.05]"
        style={{ width: size, height: size }}
        aria-hidden
      >
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none">
          <g transform={`translate(${(size - totalWidth) / 2}, ${size / 2 + 10})`}>
            {weights.map((weight, i) => {
              const height = Math.max(6, (weight / max) * 19);
              return (
                <rect
                  key={i}
                  x={i * (barWidth + gap)}
                  y={-height}
                  width={barWidth}
                  height={height}
                  rx={1.2}
                  fill="currentColor"
                  fillOpacity={i === weights.length - 1 ? 0.95 : 0.38}
                />
              );
            })}
            <rect x={-2} y={0.5} width={totalWidth + 4} height={1} rx={0.5} fill="currentColor" fillOpacity={0.22} />
          </g>
        </svg>
      </span>
    );
  }

  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-[9px] border border-dashed border-white/[0.08]"
      style={{ width: size, height: size }}
      aria-hidden
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none">
        <path
          d={`M${size / 2 - 6} ${size / 2} h12`}
          stroke="currentColor"
          strokeOpacity={0.35}
          strokeWidth={1.4}
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}
