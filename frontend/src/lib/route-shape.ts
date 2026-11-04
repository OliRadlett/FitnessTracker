/**
 * Route geometry for the activity surfaces.
 *
 * Turns an encoded polyline into a fitted SVG path, with a **real** scale bar
 * derived from the projection rather than a guessed label. No map tiles: a
 * shape plus a scale is honest about being a shape, and costs no network.
 */

import { decodePolyline } from '@/lib/polyline';

export interface RouteProjection {
  path: string;
  start: { x: number; y: number };
  end: { x: number; y: number };
  /** Metres per SVG unit, for the scale bar. */
  metresPerUnit: number;
}

function downsample<T>(points: T[], max: number): T[] {
  if (points.length <= max) return points;
  const step = points.length / max;
  return Array.from({ length: max }, (_, i) => points[Math.floor(i * step)]);
}

/**
 * Project a route into a width×height box with padding, preserving aspect
 * ratio. Equirectangular with a cos(latitude) correction is accurate enough at
 * ride scale.
 */
export function projectRoute(
  encoded: string,
  width: number,
  height: number,
  padding: number,
  maxPoints = 900,
): RouteProjection | null {
  const raw = decodePolyline(encoded);
  if (raw.length < 2) return null;
  const points = downsample(raw, maxPoints);

  const meanLat = points.reduce((sum, p) => sum + p[0], 0) / points.length;
  const kx = Math.cos((meanLat * Math.PI) / 180) * 111320; // metres per degree lng
  const ky = 110540; // metres per degree lat

  const xs = points.map((p) => p[1] * kx);
  const ys = points.map((p) => p[0] * -ky);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const spanX = Math.max(maxX - minX, 1);
  const spanY = Math.max(maxY - minY, 1);
  const usableW = width - padding * 2;
  const usableH = height - padding * 2;
  const scale = Math.min(usableW / spanX, usableH / spanY);

  const offsetX = (width - spanX * scale) / 2;
  const offsetY = (height - spanY * scale) / 2;

  const screen = xs.map((x, i) => ({
    x: offsetX + (x - minX) * scale,
    y: offsetY + (maxY - ys[i]) * scale,
  }));

  const path = screen
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
    .join(' ');

  return {
    path,
    start: screen[0],
    end: screen[screen.length - 1],
    metresPerUnit: 1 / scale,
  };
}

/** A round-number scale-bar length in metres that renders near `targetUnits`. */
export function niceScale(
  metresPerUnit: number,
  targetUnits: number,
): { metres: number; units: number; label: string } {
  const targetMetres = metresPerUnit * targetUnits;
  const power = Math.pow(10, Math.floor(Math.log10(Math.max(targetMetres, 1))));
  const candidates = [1, 2, 5, 10].map((m) => m * power);
  const metres = candidates.reduce((best, c) =>
    Math.abs(c - targetMetres) < Math.abs(best - targetMetres) ? c : best,
  );
  const label = metres >= 1000 ? `${(metres / 1000).toFixed(metres % 1000 ? 1 : 0)} km` : `${metres} m`;
  return { metres, units: metres / metresPerUnit, label };
}

/** A series fitted into a fixed box, optionally against an explicit range. */
export function seriesLine(
  values: (number | null)[],
  width: number,
  height: number,
  min?: number,
  max?: number,
  padding = 0,
): string {
  const clean = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (clean.length < 2) return '';
  const lo = min ?? Math.min(...clean);
  const hi = max ?? Math.max(...clean);
  const span = Math.max(hi - lo, 1);
  const step = width / (clean.length - 1);
  const usableH = height - padding * 2;
  return clean
    .map((v, i) => {
      const x = i * step;
      const y = padding + (1 - (v - lo) / span) * usableH;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');
}

/** Area path (line plus the baseline), used by the elevation profile. */
export function seriesArea(
  values: (number | null)[],
  width: number,
  height: number,
  padding = 2,
): { line: string; area: string; min: number; max: number } {
  const clean = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (clean.length < 2) return { line: '', area: '', min: 0, max: 0 };
  const min = Math.min(...clean);
  const max = Math.max(...clean);
  const span = Math.max(max - min, 1);
  const usableH = height - padding * 2;
  const step = width / (clean.length - 1);

  const points = clean.map((v, i) => ({
    x: i * step,
    y: padding + (1 - (v - min) / span) * usableH,
  }));

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ');
  return { line, area: `${line} L${width} ${height} L0 ${height} Z`, min, max };
}
