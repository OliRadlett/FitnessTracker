import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildRoadRibbon } from '@/lib/road';
import type { ReplayPoint } from '@/lib/replay';

function pt(x: number, y: number, z: number, distance: number): ReplayPoint {
  return { elapsed: distance, distance, x, y, z, speed: 5, power: null, hr: null, cadence: null, grade: 0 };
}

describe('buildRoadRibbon', () => {
  it('returns null for fewer than 2 points', () => {
    expect(buildRoadRibbon([])).toBeNull();
    expect(buildRoadRibbon([pt(0, 0, 0, 0)])).toBeNull();
  });

  it('emits 2 vertices per sample and 6 indices per segment', () => {
    const pts = [pt(0, 0, 0, 0), pt(10, 0, 0, 10), pt(20, 0, 0, 20)];
    const r = buildRoadRibbon(pts, { width: 6 });
    expect(r).not.toBeNull();
    expect(r!.positions.length).toBe(3 * 2 * 3);
    expect(r!.indices.length).toBe(2 * 6);
    expect(r!.count).toBe(3);
  });

  it('offsets ±half-width perpendicular to a straight eastward path', () => {
    const pts = [pt(0, 0, 0, 0), pt(10, 0, 0, 10)];
    const r = buildRoadRibbon(pts, { width: 6, zOffset: 0 });
    // forward +X → left normal +Y; edges at y = ±3
    expect(r!.positions[1]).toBeCloseTo(3, 6);
    expect(r!.positions[4]).toBeCloseTo(-3, 6);
    expect(r!.positions[0]).toBeCloseTo(0, 6);
  });

  it('raises the ribbon by zOffset and tiles v by distance/period', () => {
    const pts = [pt(0, 0, 5, 0), pt(0, 10, 5, 16)];
    const r = buildRoadRibbon(pts, { zOffset: 0.5, dashPeriodM: 8 });
    expect(r!.positions[2]).toBeCloseTo(5.5, 6);
    expect(r!.uvs[1]).toBeCloseTo(0, 6); // first sample v=0
    expect(r!.uvs[5]).toBeCloseTo(2, 6); // 16 m / 8 m period
  });

  it('omits colours by default', () => {
    const r = buildRoadRibbon([pt(0, 0, 0, 0), pt(10, 0, 0, 10)]);
    expect(r!.colors).toBeNull();
  });

  it('yields finite upward normals once uploaded (guards the Lambert shading)', () => {
    // The viewer calls computeVertexNormals on the ribbon; degenerate input
    // (duplicate points, zero-length segments) must not produce NaN normals.
    const pts = [
      pt(0, 0, 0, 0),
      pt(10, 5, 2, 12),
      pt(10, 5, 2, 12), // duplicate point — zero-area segment
      pt(25, -5, 6, 30),
    ];
    const r = buildRoadRibbon(pts, { width: 6 });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(r!.positions, 3));
    geo.setIndex(new THREE.BufferAttribute(r!.indices, 1));
    geo.computeVertexNormals();
    const n = geo.getAttribute('normal') as THREE.BufferAttribute;
    for (let i = 0; i < n.count; i++) {
      expect(Number.isFinite(n.getX(i)) && Number.isFinite(n.getY(i)) && Number.isFinite(n.getZ(i))).toBe(true);
    }
    // Flat-ish ribbon: normals point mostly up.
    expect(n.getZ(0)).toBeGreaterThan(0.5);
  });

  it('keeps nonzero width on fully degenerate input (duplicate GPS fixes)', () => {
    const pts = [pt(5, 5, 1, 0), pt(5, 5, 1, 0), pt(5, 5, 1, 0)];
    const r = buildRoadRibbon(pts, { width: 6, zOffset: 0 });
    expect(r).not.toBeNull();
    // Falls back to the last-known heading instead of collapsing to zero width.
    const w = Math.hypot(r!.positions[0] - r!.positions[3], r!.positions[1] - r!.positions[4]);
    expect(w).toBeCloseTo(6, 6);
  });

  it('skips vertical cliffs, not just horizontal gaps', () => {
    const pts = [pt(0, 0, 0, 0), pt(0, 0, 500, 10)];
    const r = buildRoadRibbon(pts, { maxSegmentM: 300 });
    expect(Array.from(r!.indices)).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('duplicates each per-point colour onto both ribbon edges', () => {
    const pts = [pt(0, 0, 0, 0), pt(10, 0, 0, 10)];
    const r = buildRoadRibbon(pts, { colors: [1, 0, 0, 0, 1, 0] });
    expect(r!.colors).not.toBeNull();
    expect(Array.from(r!.colors!.slice(0, 3))).toEqual([1, 0, 0]);
    expect(Array.from(r!.colors!.slice(3, 6))).toEqual([1, 0, 0]);
    expect(Array.from(r!.colors!.slice(6, 9))).toEqual([0, 1, 0]);
    expect(r!.colors!.length).toBe(pts.length * 2 * 3);
  });
});
