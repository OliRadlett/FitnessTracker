import { describe, it, expect } from 'vitest';
import {
  buildReplay,
  cumulativeFromVelocity,
  projectPolyline,
  replayMetricColor,
  replayMetricMax,
  replayMetricValue,
  timeFmt,
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
    expect(result.totalTime).toBe(7);
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

  it('renders missing samples as slate gaps, never false zeros', () => {
    const [r, g, b] = replayMetricColor(null, 200);
    expect([r, g, b][1]).toBeGreaterThan(0.4);
    const [r0] = replayMetricColor(0, 200);
    expect(r0).toBeCloseTo(0.231, 3);
    const [r1] = replayMetricColor(200, 200);
    expect(r1).toBeCloseTo(0.937, 3);
  });
});

describe('timeFmt', () => {  it('formats m:ss', () => {
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