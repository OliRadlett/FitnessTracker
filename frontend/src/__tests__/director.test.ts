import { describe, it, expect } from 'vitest';
import {
  ORBIT_HOLD_MS,
  ORBIT_MOVE_MS,
  ORBIT_REFRAME_RAD,
  buildDirectorPath,
  pickAutoCameraMode,
  samplePath,
  seedOrbitShot,
  updateOrbitShot,
} from '@/lib/director';
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

  it('holds a single keyframe without crashing', () => {
    const kf = { time: 0, position: [1, 2, 3] as [number, number, number], target: [4, 5, 6] as [number, number, number], fov: 50 };
    const s = samplePath({ keyframes: [kf], duration: 5 }, 2);
    expect(s.position).toEqual([1, 2, 3]);
    expect(s.target).toEqual([4, 5, 6]);
    expect(s.fov).toBe(50);
  });

  it('ignores backwards clock steps instead of un-easing the shot', () => {
    const s = seedOrbitShot(0, 1.0);
    // The hold-to-move transition fires on first observation past the
    // deadline, so the move runs [t1, t1+MOVE], not [HOLD, HOLD+MOVE].
    const t1 = ORBIT_HOLD_MS + ORBIT_MOVE_MS / 2;
    updateOrbitShot(s, t1);
    const mid = s.angle;
    expect(updateOrbitShot(s, 0)).toBe(mid); // jump back = freeze, not rewind
    expect(updateOrbitShot(s, t1 + ORBIT_MOVE_MS)).toBeCloseTo(1.0 + ORBIT_REFRAME_RAD, 6);
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

describe('orbit shot director', () => {
  it('holds the angle perfectly still for the hold window', () => {
    const s = seedOrbitShot(1000, 0.5);
    for (let t = 1000; t < 1000 + ORBIT_HOLD_MS; t += 16) {
      expect(updateOrbitShot(s, t)).toBe(0.5);
    }
  });

  it('eases monotonically to +60° over the move window, then holds again', () => {
    const s = seedOrbitShot(0, 1.0);
    // Exhaust the hold.
    updateOrbitShot(s, ORBIT_HOLD_MS);
    let prev = 1.0;
    for (let t = ORBIT_HOLD_MS; t <= ORBIT_HOLD_MS + ORBIT_MOVE_MS; t += 50) {
      const a = updateOrbitShot(s, t);
      expect(a).toBeGreaterThanOrEqual(prev);
      prev = a;
    }
    expect(updateOrbitShot(s, ORBIT_HOLD_MS + ORBIT_MOVE_MS)).toBeCloseTo(1.0 + ORBIT_REFRAME_RAD, 6);
    // Settles back into a hold at the new angle.
    expect(updateOrbitShot(s, ORBIT_HOLD_MS + ORBIT_MOVE_MS + 100)).toBeCloseTo(1.0 + ORBIT_REFRAME_RAD, 6);
  });

  it('alternates reframe direction so long-run drift cancels', () => {
    // Step like real frames: one update call advances at most one transition.
    const s = seedOrbitShot(0, 0);
    const cycle = ORBIT_HOLD_MS + ORBIT_MOVE_MS;
    let a = 0;
    for (let t = 0; t <= cycle; t += 50) a = updateOrbitShot(s, t);
    expect(a).toBeCloseTo(ORBIT_REFRAME_RAD, 6);
    for (let t = cycle; t <= 2 * cycle; t += 50) a = updateOrbitShot(s, t);
    expect(a).toBeCloseTo(0, 6);
  });

  it('keeps most frames static over a simulated minute (no continuous spin)', () => {
    const s = seedOrbitShot(0, 0);
    let staticFrames = 0;
    let total = 0;
    let prev = 0;
    for (let t = 0; t < 60_000; t += 1000 / 60) {
      const a = updateOrbitShot(s, t);
      if (Math.abs(a - prev) < 1e-9) staticFrames++;
      total++;
      prev = a;
    }
    // Holds dominate: 7 s still per ~9.5 s cycle.
    expect(staticFrames / total).toBeGreaterThan(0.6);
  });
});

describe('pickAutoCameraMode', () => {
  it('picks drone for climbs, flyby for descents, chase for sprints', () => {
    const base = { grade: 0, speed: 8, power: 150, ftpWatts: 200, nearHighlight: false };
    expect(pickAutoCameraMode({ ...base, grade: 6 })).toBe('drone');
    expect(pickAutoCameraMode({ ...base, grade: -6 })).toBe('flyby');
    expect(pickAutoCameraMode({ ...base, power: 300 })).toBe('chase');
    expect(pickAutoCameraMode({ ...base, speed: 18, grade: 2 })).toBe('chase');
    expect(pickAutoCameraMode({ ...base, nearHighlight: true })).toBe('drone');
    expect(pickAutoCameraMode(base)).toBe('orbit');
  });

  it('ignores the sprint rule without an FTP baseline', () => {
    expect(pickAutoCameraMode({ grade: 0, speed: 8, power: 400, ftpWatts: null, nearHighlight: false })).toBe(
      'orbit',
    );
  });
});
