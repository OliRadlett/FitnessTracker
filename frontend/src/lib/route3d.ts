/**
 * 3D route-view math (§3.16) — pure helpers, unit-testable without WebGL.
 *
 * Builds a drape of a route over a DEM heightmap: the encoded polyline is
 * projected onto a local metric plane (equirectangular around the centroid,
 * same convention as `lib/replay.ts`) and elevated from the route's own
 * elevation_profile where available, else bilinear-sampled from an Open-Meteo
 * elevation grid (Copernicus GLO-90). The grid itself becomes a vertex-shaded
 * terrain mesh in the same world frame.
 */

import { M_PER_DEG_LAT, cumulativePolyline, projectPolyline } from './replay';

export interface RouteGrid {
  /** grid resolution (cols is the lng axis, rows the lat axis) */
  cols: number;
  rows: number;
  /** padded grid origin (min lat/lng) in degrees */
  lat0: number;
  lng0: number;
  /** padded grid extent in degrees */
  latSpan: number;
  lngSpan: number;
  /** row (lat) and column (lng) sample coordinates */
  lats: number[];
  lngs: number[];
}

export const MAX_GRID_POINTS = 100;
export const MAX_PATH_SAMPLES = 1200;
/** gradient at which the slope colour ramp saturates (%) */
export const GRADE_SCALE = 12;

/** colour ramp stops: terrain elevation tint (hypsometric) */
export const ELEVATION_RAMP: [number, string][] = [
  [0.0, '#0ea5e9'],
  [0.2, '#34d399'],
  [0.4, '#a3e635'],
  [0.6, '#facc15'],
  [0.8, '#fb923c'],
  [1.0, '#f43f5e'],
];

/** colour ramp stops: line slope tint */
export const GRADE_RAMP: [number, string][] = [
  [0.0, '#22c55e'],
  [0.25, '#84cc16'],
  [0.5, '#eab308'],
  [0.75, '#f97316'],
  [1.0, '#ef4444'],
];

const SLATE: [number, number, number] = [0.474, 0.506, 0.549];

export interface TerrainInput {
  grid: RouteGrid;
  heights: number[];
}

export type ColorMode = 'elevation' | 'slope';

export interface RoutePathPoint {
  /** projected local-plane coordinates, metres */
  x: number;
  y: number;
  /** altitude above altMin, vertically exaggerated for 3D */
  z: number;
  /** cumulative distance in km */
  distKm: number;
  /** segment gradient % (positive = climbing) */
  slopePct: number;
  /** raw elevation in metres (null when no source) */
  elevation: number | null;
}

export interface BuildRoute3DOptions {
  coords: [number, number][];
  /** route elevation_profile.elevations, parallel to coords */
  elevations?: (number | null)[];
  /** DEM grid + heights (optional; falls back to flat path) */
  terrain?: TerrainInput | null;
  maxPathSamples?: number;
  zScale?: number;
}

export interface BuildRoute3DResult {
  path: RoutePathPoint[];
  terrainVerts: { count: number; positions: Float32Array; colors: Float32Array } | null;
  lat0: number;
  lng0: number;
  zScale: number;
  altMin: number;
  altMax: number;
  altSpan: number;
  maxSlopePct: number;
}

/** hex colour (0xRRGGBB) → [r,g,b] in 0..1 */
export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}

/** interpolate a value along a [t, hex] ramp */
export function rampColor(stops: [number, string][], t: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, t));
  for (let i = 1; i < stops.length; i++) {
    if (x <= stops[i][0]) {
      const [t0, c0] = stops[i - 1];
      const [t1, c1] = stops[i];
      const denom = t1 - t0 || 1;
      const f = (x - t0) / denom;
      const a = hexToRgb(c0);
      const b = hexToRgb(c1);
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
    }
  }
  return hexToRgb(stops[stops.length - 1][1]);
}

/** line colour for an elevation-normalised value */
export function elevationColor(t: number): [number, number, number] {
  return rampColor(ELEVATION_RAMP, t);
}

/** line colour for a grade-normalised value */
export function gradeColor(t: number): [number, number, number] {
  return rampColor(GRADE_RAMP, t);
}

/** the colour of route point `p` under the given mode */
export function pointColor(p: RoutePathPoint, mode: ColorMode, altMin: number, altSpan: number): [number, number, number] {
  if (mode === 'elevation') {
    const t = altSpan > 0 ? ((p.elevation ?? altMin) - altMin) / altSpan : 0;
    return elevationColor(t);
  }
  return gradeColor(Math.max(0, Math.min(1, p.slopePct / GRADE_SCALE)));
}

/**
 * Sample the DEM grid around a route into a ≤ `maxPoints` rectangular grid.
 * The padded bbox guarantees at least a 2×2 bed around short rides.
 */
export function computeGrid(
  coords: [number, number][],
  { maxPoints = MAX_GRID_POINTS, padMeters = 300 } = {}
): RouteGrid | null {
  if (!coords.length) return null;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const [la, ln] of coords) {
    if (la < minLat) minLat = la;
    if (la > maxLat) maxLat = la;
    if (ln < minLng) minLng = ln;
    if (ln > maxLng) maxLng = ln;
  }
  if (minLat === maxLat) {
    minLat -= 1e-4;
    maxLat += 1e-4;
  }
  if (minLng === maxLng) {
    minLng -= 1e-4;
    maxLng += 1e-4;
  }
  const midLat = (minLat + maxLat) / 2;
  const mPerDegLng = M_PER_DEG_LAT * Math.cos((midLat * Math.PI) / 180);

  const spanLatM = (maxLat - minLat) * M_PER_DEG_LAT;
  const spanLngM = (maxLng - minLng) * mPerDegLng;
  const padLat = padMeters / M_PER_DEG_LAT;
  const padLng = padMeters / mPerDegLng;

  const lat0 = minLat - padLat;
  const lng0 = minLng - padLng;
  const latSpan = maxLat - minLat + padLat * 2;
  const lngSpan = maxLng - minLng + padLng * 2;

  // Pick a cell size so a square-ish grid fits maxPoints, then enforce the cap.
  const cellM = Math.max(120, Math.max(spanLatM, spanLngM) / Math.sqrt(maxPoints));
  let cols = Math.max(2, Math.round((lngSpan * mPerDegLng) / cellM));
  let rows = Math.max(2, Math.round((latSpan * M_PER_DEG_LAT) / cellM));
  while (cols * rows > maxPoints && cols > 2 && rows > 2) {
    if (cols >= rows) cols--;
    else rows--;
  }
  // A dimension pinned at its 2-point floor can still overflow the cap — clamp.
  rows = Math.max(2, Math.min(rows, Math.floor(maxPoints / cols)));
  cols = Math.max(2, Math.min(cols, Math.floor(maxPoints / rows)));
  const lats = linspace(lat0, lat0 + latSpan, rows);
  const lngs = linspace(lng0, lng0 + lngSpan, cols);
  return { cols, rows, lat0, lng0, latSpan, lngSpan, lats, lngs };
}

/** the coordinate list sent to Open-Meteo (row-major: lat per row, lng per col) */
export function gridSampleCoords(grid: RouteGrid): { lat: number[]; lng: number[] } {
  const lat: number[] = [];
  const lng: number[] = [];
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      lat.push(grid.lats[r]);
      lng.push(grid.lngs[c]);
    }
  }
  return { lat, lng };
}

/** bilinear sample of the DEM grid at an arbitrary lat/lng (null outside data) */
export function bilinearHeight(grid: RouteGrid, heights: number[], lat: number, lng: number): number | null {
  const { cols, rows, lats, lngs } = grid;
  if (rows < 2 || cols < 2 || heights.length < rows * cols) return null;
  const latStep = lats[1] - lats[0] || 1;
  const lngStep = lngs[1] - lngs[0] || 1;
  const x = Math.max(0, Math.min(cols - 1, (lng - lngs[0]) / lngStep));
  const y = Math.max(0, Math.min(rows - 1, (lat - lats[0]) / latStep));
  const c0 = Math.floor(x);
  const r0 = Math.floor(y);
  const c1 = Math.min(cols - 1, c0 + 1);
  const r1 = Math.min(rows - 1, r0 + 1);
  const fx = x - c0;
  const fy = y - r0;
  const v00 = heights[r0 * cols + c0];
  const v10 = heights[r0 * cols + c1];
  const v01 = heights[r1 * cols + c0];
  const v11 = heights[r1 * cols + c1];
  if (![v00, v10, v01, v11].every(Number.isFinite)) return null;
  const top = v00 + (v10 - v00) * fx;
  const bot = v01 + (v11 - v01) * fx;
  const v = top + (bot - top) * fy;
  return Number.isFinite(v) ? v : null;
}

/** terrain mesh vertex data from the DEM grid, in the path's projection frame */
export function buildTerrainMesh(
  grid: RouteGrid,
  heights: number[],
  opts: { lat0: number; lng0: number; altMin: number; zScale: number }
): { count: number; positions: Float32Array; colors: Float32Array } {
  const { cols, rows, lats, lngs } = grid;
  const mPerDegLng = M_PER_DEG_LAT * Math.cos((opts.lat0 * Math.PI) / 180);
  const count = rows * cols;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);

  let lo = Infinity;
  let hi = -Infinity;
  for (const h of heights) {
    if (Number.isFinite(h)) {
      if (h < lo) lo = h;
      if (h > hi) hi = h;
    }
  }
  const span = hi - lo || 1;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = (r * cols + c) * 3;
      positions[idx] = (lngs[c] - opts.lng0) * mPerDegLng;
      positions[idx + 1] = (lats[r] - opts.lat0) * M_PER_DEG_LAT;
      positions[idx + 2] = Number.isFinite(heights[r * cols + c])
        ? (heights[r * cols + c] - opts.altMin) * opts.zScale
        : (lo - opts.altMin) * opts.zScale;

      const t = (heights[r * cols + c] - lo) / span;
      const raw = rampColor(ELEVATION_RAMP, t);
      const [r8, g8, b8] = [
        raw[0] * 0.45 + SLATE[0] * 0.55,
        raw[1] * 0.45 + SLATE[1] * 0.55,
        raw[2] * 0.45 + SLATE[2] * 0.55,
      ];
      colors[idx] = r8;
      colors[idx + 1] = g8;
      colors[idx + 2] = b8;
    }
  }
  return { count, positions, colors };
}

/**
 * Build the 3D route drape + optional terrain bed.
 * Pure — no DOM/three dependencies; unit-testable.
 */
export function buildRoute3D(opts: BuildRoute3DOptions): BuildRoute3DResult {
  const { coords, elevations, terrain } = opts;
  const empty: BuildRoute3DResult = {
    path: [],
    terrainVerts: null,
    lat0: 0,
    lng0: 0,
    zScale: 1,
    altMin: 0,
    altMax: 0,
    altSpan: 0,
    maxSlopePct: 0,
  };
  if (!coords.length) return empty;

  const { xs, ys, lat0, lng0 } = projectPolyline(coords);
  if (coords.length < 2) {
    const p = coords[0];
    const latArr = [p[0]];
    const lngArr = [p[1]];
    return buildRoute3D({ ...opts, coords: [[latArr[0], lngArr[0]], [latArr[0] + 1e-5, lngArr[0]]] });
  }
  const polyDist = cumulativePolyline(coords, xs, ys);
  const total = polyDist[polyDist.length - 1] || 0;
  const latArr = coords.map((c) => c[0]);
  const lngArr = coords.map((c) => c[1]);

  const sampleElevation = (frac: number): number | null => {
    const pos = frac * (coords.length - 1);
    const i0 = Math.max(0, Math.min(coords.length - 2, Math.floor(pos)));
    const i1 = i0 + 1;
    const t = pos - i0;
    const e0 = elevations?.[i0];
    const e1 = elevations?.[i1];
    if (typeof e0 === 'number' && typeof e1 === 'number') return e0 + (e1 - e0) * t;
    if (typeof e0 === 'number') return e0;
    if (typeof e1 === 'number') return e1;
    if (terrain) {
      const lat = interp(latArr, frac);
      const lng = interp(lngArr, frac);
      return bilinearHeight(terrain.grid, terrain.heights, lat, lng);
    }
    return null;
  };

  // Choose ≤ maxPathSamples samples spread across the cumulative-distance curve.
  const maxPathSamples = Math.max(2, opts.maxPathSamples ?? MAX_PATH_SAMPLES);
  const samples = Math.max(2, Math.min(coords.length, maxPathSamples));
  const targetDist = Array.from({ length: samples }, (_, i) => (total * i) / (samples - 1));

  const fracAtDist = (d: number): number => {
    if (total <= 0) return 0;
    const target = Math.max(0, Math.min(total, d));
    let lo = 0;
    let hi = polyDist.length - 1;
    for (let guard = 0; guard < 32 && hi - lo > 1; guard++) {
      const mid = (lo + hi) >> 1;
      if (polyDist[mid] <= target) lo = mid;
      else hi = mid;
    }
    const a = polyDist[lo];
    const b = polyDist[hi];
    const denom = b - a || 1;
    return lo / (polyDist.length - 1) + ((target - a) / denom) * (1 / (polyDist.length - 1));
  };

  const points: RoutePathPoint[] = targetDist.map((d) => {
    const frac = fracAtDist(d);
    const elevation = sampleElevation(frac);
    return { x: interp(xs, frac), y: interp(ys, frac), z: 0, distKm: d / 1000, slopePct: 0, elevation };
  });

  const alts = points.map((p) => p.elevation).filter((v): v is number => v != null);
  const altMin = alts.length ? Math.min(...alts) : 0;
  const altMax = alts.length ? Math.max(...alts) : 0;
  const altSpan = altMax - altMin;
  const extent = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) || 0;
  const zScale =
    opts.zScale ?? (altSpan > 0 ? Math.min(10, Math.max(2, (extent / (altSpan || 1)) * 0.12)) : 1);

  for (const p of points) {
    p.z = p.elevation == null ? 0 : (p.elevation - altMin) * zScale;
  }
  let maxSlopePct = 0;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    const dMeters = (cur.distKm - prev.distKm) * 1000;
    if (dMeters <= 0 || prev.elevation == null || cur.elevation == null) continue;
    const slope = ((cur.elevation - prev.elevation) / dMeters) * 100;
    cur.slopePct = slope;
    if (Math.abs(slope) > maxSlopePct) maxSlopePct = Math.abs(slope);
  }

  const terrainVerts = terrain ? buildTerrainMesh(terrain.grid, terrain.heights, { lat0, lng0, altMin, zScale }) : null;

  return { path: points, terrainVerts, lat0, lng0, zScale, altMin, altMax, altSpan, maxSlopePct };
}

function linspace(a: number, b: number, n: number): number[] {
  if (n <= 1) return [a];
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(a + ((b - a) * i) / (n - 1));
  return out;
}

function interp(values: number[], frac: number): number {
  const n = values.length;
  if (n === 1) return values[0];
  const pos = frac * (n - 1);
  const i0 = Math.max(0, Math.min(n - 2, Math.floor(pos)));
  const i1 = i0 + 1;
  const t = pos - i0;
  return values[i0] + (values[i1] - values[i0]) * t;
}