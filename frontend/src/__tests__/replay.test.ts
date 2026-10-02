import { describe, it, expect } from 'vitest';
import {
  buildReplay,
  cumulativeFromVelocity,
  groundHeightAt,
  powerZoneBounds,
  projectPolyline,
  replayMetricColor,
  replayMetricMax,
  replayMetricScale,
  replayMetricValue,
  replayDistanceAt,
  timeFmt,
  tourRate,
  type ReplayPoint,
} from '@/lib/replay';
import { decodePolyline } from '@/lib/polyline';

// A small polyline: an L-shape (lat,lng) ending -10 units north of start.
function encodePoints(points: [number, number][]): string {
  let result = '';
  let lat = 0;
  let lng = 0;
  for (const [la, ln] of points) {
    const dLat = Math.round(la * 1e5) - lat;
    const dLng = Math.round(ln * 1e5) - lng;
    lat += dLat;
    lng += dLng;
    for (const d of [dLat, dLng]) {
      let v = d < 0 ? ~(d << 1) : d << 1;
      while (v >= 0x20) {
        result += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
        v >>= 5;
      }
      result += String.fromCharCode(v + 63);
    }
  }
  return result;
}

const northwest = decodePolyline(encodePoints([
  [51.5, -0.1],
  [51.505, -0.1],
  [51.51, -0.09],
]));

describe('projectPolyline', () => {
  it('centers on the mean and maps lng/lat to a local metric plane', () => {
    const { xs, ys, lat0 } = projectPolyline(northwest);
    expect(lat0).toBeCloseTo(51.505, 5);
    // First point is south, last is north → ys ascending, centred near 0.
    expect(ys[0]).toBeLessThan(0);
    expect(ys[ys.length - 1]).toBeGreaterThan(0);
    expect(Math.abs(ys[2])).toBeGreaterThan(Math.abs((ys[0] + ys[2]) / 2));
    // Longitudes span exactly -0.1..-0.09 (0.01° ≈ 694m at this latitude).
    const spanLng = Math.max(...xs) - Math.min(...xs);
    expect(spanLng).toBeGreaterThan(600);
    expect(spanLng).toBeLessThan(800);
  });
});

describe('cumulativeFromVelocity', () => {
  it('integrates constant 5 m/s as linear distance', () => {
    const cum = cumulativeFromVelocity([0, 5, 5, 5, 5], 1);
    expect(cum[cum.length - 1]).toBe(20);
  });

  it('honours the resolution step', () => {
    const cum = cumulativeFromVelocity([5, 5], 2.5);
    expect(cum[cum.length - 1]).toBeCloseTo(12.5, 6);
  });

  it('tolerates NaN samples (standing still)', () => {
    const cum = cumulativeFromVelocity([0, Number.NaN, 5], 1);
    expect(Number.isFinite(cum[cum.length - 1])).toBe(true);
  });

  it('clamps negative velocity so distance stays monotonic', () => {
    // [0] is the t=0 origin; i=1 contributes max(0,-3)=0, i=2 adds 5.
    const cum = cumulativeFromVelocity([5, -3, 5], 1);
    expect(cum).toEqual([0, 0, 5]);
    for (let i = 1; i < cum.length; i++) {
      expect(cum[i]).toBeGreaterThanOrEqual(cum[i - 1]);
    }
  });

  it('falls back to a 1 s step for bad resolutions', () => {
    expect(cumulativeFromVelocity([5, 5], Number.NaN).at(-1)).toBe(5);
    expect(cumulativeFromVelocity([5, 5], 0).at(-1)).toBe(5);
  });
});

describe('buildReplay', () => {
  const polyline = encodePoints([
    [51.5, -0.1],
    [51.51008, -0.1],
  ]);

  it('produces monotonic distance with one sample per velocity sample', () => {
    const result = buildReplay({
      polyline,
      velocity: { values: [0, 5, 5, 5, 5, 5, 5] },
      altitude: { values: [10, 20, 30, 40, 50, 60, 70] },
    });
    expect(result.points.length).toBe(7);
    // Elapsed runs 0..6 across 7 one-second samples — totalTime is the last
    // sample's clock, not one phantom step past it.
    expect(result.totalTime).toBe(6);
    // 6 trailing 5 m/s samples integrated over 1s each.
    expect(result.totalDistance).toBeCloseTo(30, 6);
    expect(result.maxSpeed).toBe(5);
    for (let i = 1; i < result.points.length; i++) {
      expect(result.points[i].distance).toBeGreaterThanOrEqual(result.points[i - 1].distance);
    }
  });

  it('maps distance onto the polyline and lifts z from altitude', () => {
    const result = buildReplay({
      polyline,
      velocity: { values: [0, 5, 5, 5, 5] },
      altitude: { values: [0, 20, 40, 60, 80] },
    });
    const last = result.points[result.points.length - 1];
    // Final sample sits at the end of the (northward) route → y moves.
    const first = result.points[0];
    expect(Math.abs(last.y - first.y)).toBeGreaterThan(0);
    // z is altitude-min-normalised and vertically exaggerated.
    expect(last.z).toBeGreaterThan(0);
    expect(last.z).toBeGreaterThan(80); // exaggeration > 1
  });

  it('clamps distance beyond the polyline end to the route end', () => {
    // velocity overshoots the short polyline — should not throw or produce NaN.
    const result = buildReplay({
      polyline: encodePoints([[51.5, -0.1], [51.5005, -0.1]]),
      velocity: { values: [0, 50, 50, 50], resolution: 5 },
    });
    for (const p of result.points) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });

  it('respects maxSamples decimation for long rides', () => {
    const long = buildReplay({
      polyline,
      velocity: { values: Array.from({ length: 5000 }, (_, i) => 5 + (i % 2)) },
      maxSamples: 400,
    });
    expect(long.points.length).toBeLessThanOrEqual(400);
    // alternating 5/6 m/s for 4999 samples (cum[0]=0) — a fixed, checkable band.
    expect(long.totalDistance).toBeGreaterThan(27000);
    expect(long.totalDistance).toBeLessThan(28000);
  });

  it('exposes the projection frame for external mesh alignment', () => {
    const result = buildReplay({
      polyline,
      velocity: { values: [0, 5, 5, 5, 5, 5, 5] },
      altitude: { values: [10, 20, 30, 40, 50, 60, 70] },
    });
    expect(result.lat0).toBeCloseTo(51.505, 3);
    expect(result.lng0).toBeCloseTo(-0.1, 5);
    expect(result.altMin).toBe(10);
    expect(result.zScale).toBeGreaterThan(1);
  });

  it('clips to at most maxSamples even when the ride is short', () => {
    const result = buildReplay({
      polyline: encodePoints([[51.5, -0.1], [51.5005, -0.1]]),
      velocity: { values: [1, 2, 3] },
      maxSamples: 2,
    });
    expect(result.points.length).toBeLessThanOrEqual(2);
  });

  it('handles 50k+ altitude samples without stack overflow (Math.min spread guard)', () => {
    // The old code used `Math.min(...alts)` which throws RangeError on
    // large arrays (V8 arg limit ~125k). buildReplay must use a loop.
    const result = buildReplay({
      polyline,
      velocity: { values: Array.from({ length: 50000 }, (_, i) => 5 + (i % 3) * 0.1) },
      altitude: { values: Array.from({ length: 50000 }, (_, i) => 10 + Math.sin(i * 0.001) * 500) },
    });
    expect(result.points.length).toBeGreaterThan(0);
    expect(result.zScale).toBeGreaterThan(1);
  });

  it('shares a projection frame when one is passed (ghost/race alignment)', () => {
    const main = buildReplay({
      polyline,
      velocity: { values: [0, 5, 5, 5, 5, 5, 5] },
      altitude: { values: [10, 20, 30, 40, 50, 60, 70] },
    });
    // A ride 1° east has its own centroid ~70 km away — but forced into the
    // main frame it renders at the true geographic offset, not at the origin.
    const eastPolyline = encodePoints([
      [51.5, 0.9],
      [51.51008, 0.9],
    ]);
    const solo = buildReplay({
      polyline: eastPolyline,
      velocity: { values: [0, 5, 5, 5, 5, 5, 5] },
      altitude: { values: [10, 20, 30, 40, 50, 60, 70] },
    });
    expect(Math.abs(solo.points[0].x)).toBeLessThan(100);
    const shared = buildReplay({
      polyline: eastPolyline,
      velocity: { values: [0, 5, 5, 5, 5, 5, 5] },
      altitude: { values: [10, 20, 30, 40, 50, 60, 70] },
      frame: { lat0: main.lat0, lng0: main.lng0 },
      altBase: { altMin: main.altMin, zScale: main.zScale },
    });
    expect(shared.lat0).toBeCloseTo(main.lat0, 9);
    expect(shared.lng0).toBeCloseTo(main.lng0, 9);
    expect(shared.altMin).toBe(main.altMin);
    expect(shared.zScale).toBe(main.zScale);
    // ~1° lng at 51.5°N ≈ 70 km east of the main frame origin.
    expect(shared.points[0].x).toBeGreaterThan(60000);
    // Same altitude profile in the same vertical base → same z.
    expect(shared.points[6].z).toBeCloseTo(main.points[6].z, 6);
  });

  it('returns an empty build (not a bogus negative-index point) without velocity', () => {
    const result = buildReplay({ polyline, velocity: { values: [] } });
    expect(result.points).toEqual([]);
    expect(result.totalTime).toBe(0);
    expect(result.totalDistance).toBe(0);
    expect(result.maxSpeed).toBe(0);
  });

  it('aligns streams by sample under variable speed, not by distance fraction', () => {
    // Sprint start then cruise: distances [0, 1, 10, 19] — a distance-fraction
    // mapping would read sample 1's power from the wrong index.
    const result = buildReplay({
      polyline,
      velocity: { values: [0, 1, 9, 9] },
      power: { values: [0, 400, 150, 150] },
    });
    expect(result.points[1].power).toBe(400);
    expect(result.points[2].power).toBe(150);
  });
});

describe('replay metric colours', () => {
  const polyline = encodePoints([
    [51.5, -0.1],
    [51.51008, -0.1],
  ]);

  it('carries cadence and grade on each point', () => {
    const result = buildReplay({
      polyline,
      velocity: { values: [0, 5, 5, 5, 5] },
      altitude: { values: [0, 10, 20, 30, 40] },
      cadence: { values: [0, 80, 85, 90, 88] },
    });
    expect(result.points[2].cadence).toBe(85);
    // 10 m over 5 m → steep test hill, but finite and positive.
    expect(result.points[2].grade).toBeCloseTo(200, 0);
    expect(result.points[0].grade).toBeNull();
  });

  it('leaves grade null without altitude', () => {
    const result = buildReplay({
      polyline,
      velocity: { values: [0, 5, 5] },
    });
    expect(result.points.every((p) => p.grade === null)).toBe(true);
    expect(result.points.every((p) => p.cadence === null)).toBe(true);
  });

  it('normalises intensity metrics by max, grade by the fixed ramp', () => {
    const result = buildReplay({
      polyline,
      velocity: { values: [0, 5, 10] },
      power: { values: [0, 100, 200] },
    });
    expect(replayMetricMax(result.points, 'speed')).toBe(10);
    expect(replayMetricMax(result.points, 'power')).toBe(200);
    expect(replayMetricMax(result.points, 'hr')).toBe(1);
    expect(replayMetricMax(result.points, 'grade')).toBe(12);
    expect(replayMetricValue(result.points[1], 'power')).toBe(100);
  });

  it('scales colour by p95 so one spike does not flatten contrast', () => {
    // Twenty samples at 10 m/s plus one GPS spike at 100.
    const result = buildReplay({
      polyline,
      velocity: { values: [...Array<number>(20).fill(10), 100] },
    });
    expect(replayMetricMax(result.points, 'speed')).toBe(100);
    expect(replayMetricScale(result.points, 'speed')).toBeCloseTo(11, 5);
  });

  it('falls back to max for tiny or all-zero data', () => {
    const tiny = buildReplay({ polyline, velocity: { values: [0, 5, 10] } });
    expect(replayMetricScale(tiny.points, 'speed')).toBe(10);
    const flat = buildReplay({ polyline, velocity: { values: [0, 0, 0] } });
    expect(replayMetricScale(flat.points, 'speed')).toBe(1);
    expect(replayMetricScale(tiny.points, 'grade')).toBe(12);
  });

  it('renders missing samples as slate gaps, never false zeros', () => {
    const [r, g, b] = replayMetricColor(null, 200);
    expect([r, g, b][1]).toBeGreaterThan(0.4);
    const [r0] = replayMetricColor(0, 200);
    expect(r0).toBeCloseTo(0.231, 3);
    const [r1] = replayMetricColor(200, 200);
    expect(r1).toBeCloseTo(0.937, 3);
  });
});

describe('powerZoneBounds', () => {
  it('scales Coggan fractions by FTP', () => {
    const b = powerZoneBounds(200);
    expect(b).toHaveLength(7);
    expect(b[0]).toBeCloseTo(110, 5);
    expect(b[3]).toBeCloseTo(210, 5);
    expect(b[6]).toBe(Infinity);
    for (let i = 1; i < 6; i++) expect(b[i]).toBeGreaterThan(b[i - 1]);
  });
});

describe('tourRate', () => {
  it('finishes an hour ride in about a minute at 60x', () => {
    expect(tourRate(3600, 60)).toBe(60);
    expect(tourRate(4044, 60)).toBe(67);
    expect(tourRate(3600, 120)).toBe(30);
    expect(tourRate(3600, 30)).toBe(120);
  });

  it('floors at 1x for short or invalid durations', () => {
    expect(tourRate(20, 60)).toBe(1);
    expect(tourRate(0, 60)).toBe(1);
    expect(tourRate(-5, 60)).toBe(1);
    expect(tourRate(3600, 0)).toBe(1);
  });
});

describe('timeFmt', () => {
  it('formats m:ss', () => {
    expect(timeFmt(0)).toBe('0:00');
    expect(timeFmt(65)).toBe('1:05');
  });
  it('formats h:mm:ss', () => {
    expect(timeFmt(3661)).toBe('1:01:01');
  });
  it('clamps negatives to zero', () => {
    expect(timeFmt(-5)).toBe('0:00');
  });
});

describe('replayDistanceAt', () => {
  const pts = [0, 10, 20, 30].map((d, i) => ({
    elapsed: i * 10,
    distance: d,
    x: 0,
    y: 0,
    z: 0,
    speed: 1,
    power: null,
    hr: null,
    cadence: null,
    grade: 0,
  }));

  it('interpolates between samples', () => {
    expect(replayDistanceAt(pts, 15)).toBeCloseTo(15, 6);
    expect(replayDistanceAt(pts, 0)).toBe(0);
    expect(replayDistanceAt(pts, 30)).toBe(30);
  });

  it('clamps outside the ride', () => {
    expect(replayDistanceAt(pts, -5)).toBe(0);
    expect(replayDistanceAt(pts, 999)).toBe(30);
    expect(replayDistanceAt([], 5)).toBe(0);
  });

  describe('extendTruncatedStream', () => {
    // A polyline spanning ~50 km (straight line east, 500 points ~100 m apart),
    // driven by a short stream covering ~5 km — mimics a Strava-truncated stream.
    const longPolyline = encodePoints(
      Array.from({ length: 500 }, (_, i): [number, number] => [
        51.5,
        -0.13 + i * 0.0009,
      ]),
    );

    it('extends the replay to the full polyline when the stream is truncated', () => {
      const result = buildReplay({
        polyline: longPolyline,
        velocity: { values: Array.from({ length: 100 }, () => 5), resolution: 1 },
        activityDistanceMeters: 50000,
      });
      // Stream covers ~500 m; extension walks the remaining polyline.
      expect(result.totalDistance).toBeGreaterThan(25000);
    });

    it('does not extend when no activity distance is supplied', () => {
      const result = buildReplay({
        polyline: longPolyline,
        velocity: { values: Array.from({ length: 100 }, () => 5), resolution: 1 },
      });
      // Without activity distance we trust the stream (~500 m).
      expect(result.totalDistance).toBeLessThan(1000);
    });
  });
});

describe('groundHeightAt', () => {
  const pts = (zs: number[]): ReplayPoint[] =>
    zs.map((z, i) => ({
      elapsed: i,
      distance: i * 10,
      x: i * 10,
      y: 0,
      z,
      speed: 5,
      power: null,
      hr: null,
      cadence: null,
      grade: null,
    }));

  it('returns the z of the nearest point by ground distance', () => {
    const points = pts([10, 20, 30]); // x = 0, 10, 20
    expect(groundHeightAt(points, 0, 0)).toBe(10);
    expect(groundHeightAt(points, 21, 0)).toBe(30);
    expect(groundHeightAt(points, 9, 0)).toBe(20);
    expect(groundHeightAt(points, 4, 0)).toBe(10);
  });

  it('ignores altitude when measuring nearness (pure x/y)', () => {
    // points at x=0 (z=100) and x=10 (z=0): proximity is by x/y only.
    const points = pts([100, 0]);
    expect(groundHeightAt(points, 15, 0)).toBe(0);
    expect(groundHeightAt(points, 4, 0)).toBe(100);
  });

  it('returns 0 for an empty path', () => {
    expect(groundHeightAt([], 5, 5)).toBe(0);
  });
});