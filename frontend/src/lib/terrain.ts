/**
 * DEM terrain lookup for the 3D route view (§3.16).
 *
 * Uses the free Open-Meteo Elevation API (Copernicus GLO-90, 90m resolution).
 * No API key required for non-commercial use; attribution to Copernicus is
 * required (shown in the Route3D footer). Same provider as the weather caches.
 * https://open-meteo.com/en/docs/elevation-api
 */

import type { RouteGrid } from './route3d';
import { gridSampleCoords } from './route3d';

const ELEVATION_URL = 'https://api.open-meteo.com/v1/elevation';

export interface TerrainResult {
  grid: RouteGrid;
  heights: number[];
}

/** errors that should fall back to a flat draped path rather than crash */
export class TerrainError extends Error {}

/**
 * Fetch DEM heights for every point of a pre-computed grid (≤ MAX_GRID_POINTS,
 * so a single request covers the whole route).
 */
export async function fetchTerrainResult(grid: RouteGrid, signal?: AbortSignal): Promise<TerrainResult> {
  const { lat, lng } = gridSampleCoords(grid);
  const qs = new URLSearchParams();
  qs.set('latitude', lat.join(','));
  qs.set('longitude', lng.join(','));
  let res: Response;
  try {
    res = await fetch(`${ELEVATION_URL}?${qs.toString()}`, { signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new TerrainError('Elevation service unreachable.');
  }
  if (!res.ok) {
    throw new TerrainError(`Elevation service responded ${res.status}.`);
  }
  const json = (await res.json()) as { elevation?: number[]; error?: boolean; reason?: string };
  if (json.error || !Array.isArray(json.elevation)) {
    throw new TerrainError(json.reason ?? 'Elevation service returned no data.');
  }
  if (json.elevation.length !== lat.length) {
    throw new TerrainError('Elevation service returned a mismatched response.');
  }
  return { grid, heights: json.elevation };
}