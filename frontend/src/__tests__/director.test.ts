import { describe, it, expect } from 'vitest';
import { buildDirectorPath, samplePath } from '@/lib/director';
import type { ReplayBuildResult, ReplayPoint } from '@/lib/replay';

function stubBuild(): ReplayBuildResult {
  const points: ReplayPoint[] = [];
  for (let i = 0; i <= 200; i++) {
    points.push({ elapsed: i, distance: i * 10, x: i * 10, y: Math.sin(i / 20) * 100, z: 5, speed: 8, power: 200, hr: 150, cadence: 90, grade: 1 });
  }
  return { points, totalDistance: 2000, totalTime: 200, altMin: 0, zScale: 3, maxSpeed: 10, lat0: 51.5, lng0: -0.1 };
}

function emptyBuild(): ReplayBuildResult {
  return { points: [], totalDistance: 0, totalTime: 0, altMin: 0, zScale: 1, maxSpeed: 0, lat0: 0, lng0: 0 };
}

describe('buildDirectorPath', () => {
  it('returns empty for trivial paths', () => {
    const path = buildDirectorPath(emptyBuild());
    expect(path.keyframes).toEqual([]);
  });

  it('produces keyframes spanning the configured duration', () => {
    const path = buildDirectorPath(stubBuild(), { introSeconds: 9 });
    expect(path.duration).toBe(9);
    expect(path.keyframes.length).toBe(31); // 0..30 inclusive
    expect(path.keyframes[0].time).toBe(0);
    expect(path.keyframes[path.keyframes.length - 1].time).toBeCloseTo(9, 5);
  });

  it('descends: first keyframe higher than last', () => {
    const path = buildDirectorPath(stubBuild());
    expect(path.keyframes[0].position[2]).toBeGreaterThan(path.keyframes[path.keyframes.length - 1].position[2]);
  });

  it('narrows FOV as it descends', () => {
    const path = buildDirectorPath(stubBuild());
    expect(path.keyframes[0].fov).toBeGreaterThan(path.keyframes[path.keyframes.length - 1].fov);
  });
});

describe('samplePath', () => {
  it('clamps before and after the path', () => {
    const path = buildDirectorPath(stubBuild());
    const before = samplePath(path, -5);
    const start = samplePath(path, 0);
    expect(before.position[0]).toBeCloseTo(start.position[0], 3);
    const after = samplePath(path, 9999);
    const end = samplePath(path, path.duration);
    expect(after.position[0]).toBeCloseTo(end.position[0], 3);
  });

  it('returns sane defaults for empty paths', () => {
    const s = samplePath({ keyframes: [], duration: 0 }, 1);
    expect(s.fov).toBe(55);
  });

  it('produces a finite, continuous path', () => {
    const path = buildDirectorPath(stubBuild());
    let prev = samplePath(path, 0).position;
    for (let t = 0.1; t <= path.duration; t += 0.5) {
      const s = samplePath(path, t);
      for (const c of s.position) expect(Number.isFinite(c)).toBe(true);
      // steps should be finite (not NaN)
      const d = Math.hypot(s.position[0] - prev[0], s.position[1] - prev[1], s.position[2] - prev[2]);
      expect(Number.isFinite(d)).toBe(true);
      prev = s.position;
    }
  });
});
