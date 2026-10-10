'use client';

import type { CSSProperties } from 'react';

/**
 * Shared Recharts theme tokens — Phase 3 data-viz system (ui-redesign-v2 §3.3).
 *
 * Hex literals mirroring the dark-theme CSS channels in `globals.css`
 * (`--muted`, `--surface-light`, …). Recharts renders SVG, so the
 * `rgb(var(--x) / …)` Tailwind tokens can't be used directly here — keep the
 * two in sync by hand (dark values; the light theme only shifts surfaces).
 *
 * Presentational only: no computation, no data changes.
 */

/** Axis tick / axis-label color (muted). */
export const CHART_AXIS = '#94a3b8';
/** Grid + axis-line color (surface-light). */
export const CHART_GRID = '#334155';
/** Tooltip surface / border / text (surface / surface-light / foreground). */
export const CHART_TOOLTIP_BG = '#1e293b';
export const CHART_TOOLTIP_BORDER = '#334155';
export const CHART_TOOLTIP_TEXT = '#e2e8f0';
/** Stale-data badge dot (caution). */
export const CHART_STALE = '#f59e0b';

/** Training-zone band colors (info → positive → caution → warning). */
export const CHART_ZONES = {
  info: '#38bdf8',
  positive: '#22c55e',
  caution: '#f59e0b',
  warning: '#ef4444',
  accent: '#3b82f6',
} as const;

/** Default series palette (aligned with Tailwind accent/positive/warning). */
export const CHART_SERIES_COLORS = [
  '#3b82f6',
  '#22c55e',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#ec4899',
  '#06b6d4',
  '#f97316',
] as const;

/**
 * Type floor: 12px everywhere, 11px reserved for timestamps only
 * (ui-redesign-v2 §3.1). Recharts tick props take these directly.
 */
export const CHART_FONT_BODY = 12;
export const CHART_FONT_TIMESTAMP = 11;

/** Shared tick style: muted, 12px floor, tabular numerals (§3.1). */
export const CHART_TICK_STYLE = {
  fill: CHART_AXIS,
  fontSize: CHART_FONT_BODY,
  fontVariantNumeric: 'tabular-nums',
} as const;

/**
 * Label-culling rules — overlapping axis/legend labels are rotated or
 * dropped, never overlapped (fixes the Form Trend complaint).
 *
 * Category X axes show at most ~10 ticks on desktop, ~4 on phones; the
 * rest are dropped via `interval`. Dense date axes additionally rotate
 * so day labels can't collide.
 */
export function xTickInterval(pointCount: number, isNarrow: boolean): number {
  const maxTicks = isNarrow ? 4 : 10;
  if (pointCount <= maxTicks) return 0;
  return Math.ceil(pointCount / maxTicks) - 1;
}

/** Rotation for dense category axes (0 = horizontal). */
export function xTickAngle(pointCount: number): number {
  return pointCount > 15 ? -30 : 0;
}

/** Extra X-axis height needed when rotated labels hang below the axis. */
export function xAxisHeight(pointCount: number): number {
  return pointCount > 15 ? 48 : 30;
}

/**
 * Legend chrome: single shared style, 12px floor, wraps to a second line
 * instead of overlapping. Slice/series names are never truncated away —
 * the pie chart drops slice labels on narrow screens because the legend
 * carries the names there.
 */
export function legendWrapperStyle(isNarrow: boolean): CSSProperties {
  return {
    color: CHART_AXIS,
    fontSize: CHART_FONT_BODY,
    lineHeight: '16px',
    maxWidth: '100%',
    overflow: 'hidden',
    // Two-line cap: long multi-series legends clip instead of pushing layout.
    maxHeight: isNarrow ? '32px' : '36px',
  };
}
