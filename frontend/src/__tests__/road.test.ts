import { describe, it, expect } from 'vitest';
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
});
