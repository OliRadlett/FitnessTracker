/**
 * High-resolution DEM terrain for the Relive viewer (Phase 1).
 *
 * Fetches keyless **terrarium** elevation tiles (AWS Open Data; SRTM + UK LiDAR,
 * ~30 m) and samples them into a dense lat/lng grid, so the terrain reads as real
 * relief instead of the ~1 km Open-Meteo grid. CORS is allowed (`*`), so pixels
 * are readable from a canvas. Falls back to `lib/terrain` (Open-Meteo) upstream.
 *
 * Pure tile/decode math is exported and unit-tested; the fetch/decode path needs
 * a browser (canvas).
 */

import type { RouteGrid } from './route3d';
import { computeGrid } from './route3d';

const TILE_URL = (z: number, x: number, y: number) =>
  `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;

export const TERRARIUM_ATTRIBUTION = 'Terrain © Mapzen / AWS Terrain Tiles (SRTM, UK LiDAR)';

export class TerrainTilesError extends Error {}

/** terrarium RGB → metres (height = R·256 + G + B/256 − 32768) */
export function terrariumDecode(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768;
}

/** fractional global pixel position (256 px per tile) at zoom `z` */
export function lngLatToPixel(lat: number, lng: number, z: number): { x: number; y: number } {
  const n = 2 ** z * 256;
  const x = ((lng + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return { x, y };
}

export interface TileRange {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export function tileRangeForBbox(lat0: number, lng0: number, lat1: number, lng1: number, z: number): TileRange {
  const a = lngLatToPixel(lat0, lng0, z);
  const b = lngLatToPixel(lat1, lng1, z);
  const ax = Math.floor(a.x / 256);
  const bx = Math.floor(b.x / 256);
  const ay = Math.floor(a.y / 256);
  const by = Math.floor(b.y / 256);
  return { x0: Math.min(ax, bx), x1: Math.max(ax, bx), y0: Math.min(ay, by), y1: Math.max(ay, by) };
}

/** highest zoom whose tile count stays within `maxTiles` (clamped to [minZ, maxZ]) */
export function chooseZoom(
  lat0: number,
  lng0: number,
  lat1: number,
  lng1: number,
  maxTiles: number,
  minZ = 6,
  maxZ = 15,
): number {
  let best = minZ;
  for (let z = minZ; z <= maxZ; z++) {
    const r = tileRangeForBbox(lat0, lng0, lat1, lng1, z);
    const count = (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1);
    if (count <= maxTiles) best = z;
    else break;
  }
  return best;
}

export interface TerrariumResult {
  grid: RouteGrid;
  heights: number[];
  attribution: string;
}

function linspace(a: number, b: number, n: number): number[] {
  if (n <= 1) return [a];
  const step = (b - a) / (n - 1);
  return Array.from({ length: n }, (_, i) => a + step * i);
}

const tileCache = new Map<string, Float32Array>();

async function loadTile(z: number, x: number, y: number, signal?: AbortSignal): Promise<Float32Array> {
  const key = `${z}/${x}/${y}`;
  const hit = tileCache.get(key);
  if (hit) return hit;
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.decoding = 'async';
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new TerrainTilesError('DEM tile failed to load.'));
    signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    img.src = TILE_URL(z, x, y);
  });
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new TerrainTilesError('no-2d-context');
  ctx.drawImage(img, 0, 0, 256, 256);
  const data = ctx.getImageData(0, 0, 256, 256).data;
  const out = new Float32Array(256 * 256);
  for (let i = 0; i < out.length; i++) out[i] = terrariumDecode(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
  tileCache.set(key, out);
  return out;
}

/** bilinear sample of the stitched tiles at a lat/lng (clamped to the tile edge) */
function sampleTiles(tiles: Map<string, Float32Array>, z: number, lat: number, lng: number): number {
  const { x, y } = lngLatToPixel(lat, lng, z);
  const tx = Math.floor(x / 256);
  const ty = Math.floor(y / 256);
  const lx = x - tx * 256;
  const ly = y - ty * 256;
  const tile = tiles.get(`${tx}/${ty}`);
  if (!tile) return 0;
  const c0 = Math.max(0, Math.min(255, Math.floor(lx)));
  const r0 = Math.max(0, Math.min(255, Math.floor(ly)));
  const c1 = Math.min(255, c0 + 1);
  const r1 = Math.min(255, r0 + 1);
  const fx = lx - c0;
  const fy = ly - r0;
  const v00 = tile[r0 * 256 + c0];
  const v10 = tile[r0 * 256 + c1];
  const v01 = tile[r1 * 256 + c0];
  const v11 = tile[r1 * 256 + c1];
  const top = v00 + (v10 - v00) * fx;
  const bot = v01 + (v11 - v01) * fx;
  return top + (bot - top) * fy;
}

/**
 * Fetch + sample a dense terrarium grid over the ride's padded bbox. Throws
 * `TerrainTilesError` on failure (caller falls back to Open-Meteo).
 */
export async function fetchTerrariumTerrain(
  coords: [number, number][],
  { maxTiles = 16, maxGridPoints = 65536, signal }: { maxTiles?: number; maxGridPoints?: number; signal?: AbortSignal } = {},
): Promise<TerrariumResult> {
  const spec = computeGrid(coords, { maxPoints: 200 });
  if (!spec) throw new TerrainTilesError('no-bbox');
  const { lat0, lng0, latSpan, lngSpan } = spec;
  const lat1 = lat0 + latSpan;
  const lng1 = lng0 + lngSpan;
  const z = chooseZoom(lat0, lng0, lat1, lng1, maxTiles);

  // aspect-correct dense grid, capped
  const midLat = (lat0 + lat1) / 2;
  const aspect = (lngSpan * Math.cos((midLat * Math.PI) / 180)) / (latSpan || 1e-6) || 1;
  let cols = Math.max(2, Math.round(Math.sqrt(maxGridPoints * aspect)));
  let rows = Math.max(2, Math.round(maxGridPoints / cols));
  cols = Math.min(cols, 384);
  rows = Math.min(rows, 384);
  const lats = linspace(lat0, lat1, rows);
  const lngs = linspace(lng0, lng1, cols);

  const range = tileRangeForBbox(lat0, lng0, lat1, lng1, z);
  const tiles = new Map<string, Float32Array>();
  const jobs: Promise<void>[] = [];
  for (let x = range.x0; x <= range.x1; x++) {
    for (let y = range.y0; y <= range.y1; y++) {
      jobs.push(
        loadTile(z, x, y, signal).then((h) => {
          tiles.set(`${x}/${y}`, h);
        }),
      );
    }
  }
  await Promise.all(jobs);

  const heights = new Array<number>(rows * cols);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) heights[r * cols + c] = sampleTiles(tiles, z, lats[r], lngs[c]);
  }

  return {
    grid: { cols, rows, lat0, lng0, latSpan, lngSpan, lats, lngs },
    heights,
    attribution: TERRARIUM_ATTRIBUTION,
  };
}
