import { describe, it, expect } from 'vitest';
import { buildShotPath, pickBeatShot, shotWantsOverview } from '@/lib/shots';
import type { ReplayPoint } from '@/lib/replay';

function line(n = 100): ReplayPoint[] {
  const pts: ReplayPoint[] = [];
  for (let i = 0; i < n; i++) {
    pts.push({
      elapsed: i * 2,
      distance: i * 10,
      x: i * 10,
      y: 0,
      z: i * 0.5,
      speed: 8,
      power: 200,
      hr: null,
      cadence: null,
      grade: 1,
    });
  }
  return pts;
}

describe('pickBeatShot', () => {
  it('maps each beat to its signature shot', () => {
    expect(pickBeatShot('attack')).toBe('chase-low');
    expect(pickBeatShot('finale')).toBe('rise-reveal');
    expect(pickBeatShot('comeback')).toBe('track');
  });

  it('reserves the full overview for reveal shots only', () => {
    expect(shotWantsOverview('drone-pull')).toBe(true);
    expect(shotWantsOverview('rise-reveal')).toBe(true);
    expect(shotWantsOverview('chase-low')).toBe(false);
    expect(shotWantsOverview('track')).toBe(false);
    expect(shotWantsOverview('orbit-punch')).toBe(false);
  });
});

describe('buildShotPath', () => {
  const kinds = ['chase-low', 'track', 'orbit-punch', 'drone-pull', 'rise-reveal'] as const;

  it('returns an empty path without usable geometry', () => {
    expect(buildShotPath([], 'chase-low', 0).keyframes).toEqual([]);
    expect(buildShotPath(line(1), 'chase-low', 0).keyframes).toEqual([]);
    expect(buildShotPath(line(), 'chase-low', 0, { durationS: 0 }).duration).toBe(0);
  });

  it('emits ascending, finite keyframes spanning the duration', () => {
    for (const kind of kinds) {
      const path = buildShotPath(line(), kind, 100);
      expect(path.keyframes.length).toBeGreaterThanOrEqual(2);
      expect(path.duration).toBeGreaterThan(0);
      expect(path.keyframes[0].time).toBe(0);
      const last = path.keyframes[path.keyframes.length - 1];
      expect(last.time).toBeCloseTo(path.duration, 6);
      for (let i = 1; i < path.keyframes.length; i++) {
        expect(path.keyframes[i].time).toBeGreaterThan(path.keyframes[i - 1].time);
      }
      for (const k of path.keyframes) {
        for (const c of [...k.position, ...k.target]) expect(Number.isFinite(c)).toBe(true);
        expect(k.fov).toBeGreaterThan(35);
        expect(k.fov).toBeLessThan(70);
      }
    }
  });

  it('pulls the drone up and out while the chase stays low', () => {
    const drone = buildShotPath(line(), 'drone-pull', 100);
    const chase = buildShotPath(line(), 'chase-low', 100);
    const rise = (p: typeof drone) =>
      p.keyframes[p.keyframes.length - 1].position[2] - p.keyframes[0].position[2];
    expect(rise(drone)).toBeGreaterThan(rise(chase));
    expect(rise(drone)).toBeGreaterThan(5);
  });

  it('frames the rider at mid-path, not empty ground', () => {
    // At t=100 s the rider sits at x=500 on the test line; every template's
    // targets must cluster near the track, far from the origin.
    for (const kind of kinds) {
      const path = buildShotPath(line(), kind, 100);
      for (const k of path.keyframes) {
        expect(Math.abs(k.target[0] - 500)).toBeLessThan(120);
      }
    }
  });
});
