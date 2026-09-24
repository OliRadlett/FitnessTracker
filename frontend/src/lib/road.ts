/**
 * Road-ribbon geometry for the Relive 3D viewer (Phase 1).
 *
 * Turns the replay path into a flat asphalt ribbon (a triangle strip offset to
 * each side of the track) so the bike rides a road instead of a floating line.
 * UVs run across the width (0..1) and along cumulative distance / `dashPeriodM`,
 * so a repeating dash texture tiles evenly at any ride length. Pure — no
 * three/DOM — unit-tested.
 */

import type { ReplayPoint } from './replay';

export interface RoadRibbon {
  positions: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  /** per-vertex RGB (0..1), parallel to positions — null when no colours given */
  colors: Float32Array | null;
  /** number of path samples (2 vertices each) */
  count: number;
}

export interface RoadOptions {
  /** road width in metres */
  width?: number;
  /** lift above the path so it clears the terrain/grid */
  zOffset?: number;
  /** texture repeat period along the road, in metres */
  dashPeriodM?: number;
  /** per-path-point RGB (0..1) as a flat array (length n*3); duplicated onto
   *  both ribbon edges for tinting */
  colors?: ArrayLike<number> | null;
}

/** Build a road ribbon from the replay path (null when fewer than 2 points). */
export function buildRoadRibbon(points: ReplayPoint[], opts: RoadOptions = {}): RoadRibbon | null {
  const n = points.length;
  if (n < 2) return null;
  const half = (opts.width ?? 6) / 2;
  const zOffset = opts.zOffset ?? 0.04;
  const period = opts.dashPeriodM ?? 8;
  const inColors = opts.colors && opts.colors.length >= n * 3 ? opts.colors : null;

  const positions = new Float32Array(n * 2 * 3);
  const uvs = new Float32Array(n * 2 * 2);
  const indices = new Uint32Array((n - 1) * 6);
  const colors = inColors ? new Float32Array(n * 2 * 3) : null;

  for (let i = 0; i < n; i++) {
    const p = points[i];
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(n - 1, i + 1)];
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    // ground-plane left normal
    const lx = -dy;
    const ly = dx;
    const z = p.z + zOffset;
    const o = i * 6;
    positions[o] = p.x + lx * half;
    positions[o + 1] = p.y + ly * half;
    positions[o + 2] = z;
    positions[o + 3] = p.x - lx * half;
    positions[o + 4] = p.y - ly * half;
    positions[o + 5] = z;
    const u = i * 4;
    const v = p.distance / period;
    uvs[u] = 0;
    uvs[u + 1] = v;
    uvs[u + 2] = 1;
    uvs[u + 3] = v;
    if (colors && inColors) {
      const c = i * 3;
      colors[o] = inColors[c];
      colors[o + 1] = inColors[c + 1];
      colors[o + 2] = inColors[c + 2];
      colors[o + 3] = inColors[c];
      colors[o + 4] = inColors[c + 1];
      colors[o + 5] = inColors[c + 2];
    }
  }

  for (let i = 0; i < n - 1; i++) {
    const a = i * 2;
    const b = a + 1;
    const c = a + 2;
    const d = a + 3;
    const o = i * 6;
    indices[o] = a;
    indices[o + 1] = b;
    indices[o + 2] = c;
    indices[o + 3] = b;
    indices[o + 4] = d;
    indices[o + 5] = c;
  }

  return { positions, uvs, indices, colors, count: n };
}
