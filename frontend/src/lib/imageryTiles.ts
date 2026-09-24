/**
 * Optional satellite imagery drape for the Relive terrain (Phase 3).
 *
 * Stitches keyless **Esri World Imagery** tiles (CORS `*`) into one canvas that
 * is UV-mapped onto the DEM mesh. Attribution is required (shown in the viewer
 * footer). Pure tile math is reused from `terrainTiles`.
 */

import type { RouteGrid } from './route3d';
import { chooseZoom, lngLatToPixel, tileRangeForBbox } from './terrainTiles';

export const IMAGERY_ATTRIBUTION = 'Imagery © Esri, Maxar, Earthstar Geographics';

const TILE_URL = (z: number, x: number, y: number) =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;

export class ImageryError extends Error {}

export interface ImageryDrape {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  z: number;
  x0: number;
  y0: number;
}

/** UV (0..1) of a lat/lng within the stitched imagery canvas (v flipped for three.js) */
export function imageryUv(drape: ImageryDrape, lat: number, lng: number): [number, number] {
  const p = lngLatToPixel(lat, lng, drape.z);
  const u = (p.x - drape.x0 * 256) / drape.width;
  const v = 1 - (p.y - drape.y0 * 256) / drape.height;
  return [Math.max(0, Math.min(1, u)), Math.max(0, Math.min(1, v))];
}

function loadImage(url: string, signal?: AbortSignal): Promise<HTMLImageElement> {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.decoding = 'async';
  return new Promise((resolve, reject) => {
    img.onload = () => resolve(img);
    img.onerror = () => reject(new ImageryError('Imagery tile failed to load.'));
    signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    img.src = url;
  });
}

/** Stitch the Esri tiles covering `grid`'s bbox into a single canvas. */
export async function fetchImageryDrape(
  grid: RouteGrid,
  { maxTiles = 16, signal }: { maxTiles?: number; signal?: AbortSignal } = {},
): Promise<ImageryDrape> {
  const lat1 = grid.lat0 + grid.latSpan;
  const lng1 = grid.lng0 + grid.lngSpan;
  const z = chooseZoom(grid.lat0, grid.lng0, lat1, lng1, maxTiles);
  const r = tileRangeForBbox(grid.lat0, grid.lng0, lat1, lng1, z);
  const cols = r.x1 - r.x0 + 1;
  const rows = r.y1 - r.y0 + 1;
  const canvas = document.createElement('canvas');
  canvas.width = cols * 256;
  canvas.height = rows * 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new ImageryError('no-2d-context');

  const jobs: Promise<void>[] = [];
  for (let x = r.x0; x <= r.x1; x++) {
    for (let y = r.y0; y <= r.y1; y++) {
      jobs.push(
        loadImage(TILE_URL(z, x, y), signal).then((img) => {
          ctx.drawImage(img, (x - r.x0) * 256, (y - r.y0) * 256, 256, 256);
        }),
      );
    }
  }
  await Promise.all(jobs);

  return { canvas, width: canvas.width, height: canvas.height, z, x0: r.x0, y0: r.y0 };
}
