import { describe, it, expect } from 'vitest';
import {
  computeDifficulty,
  fmtElevation,
  fmtDurationShort,
  haversineDistance,
} from '@/lib/routeUtils';

describe('computeDifficulty', () => {
  it('returns null when elevation gain is missing or zero', () => {
    expect(computeDifficulty(null, 10_000)).toBeNull();
    expect(computeDifficulty(undefined, 10_000)).toBeNull();
    expect(computeDifficulty(0, 10_000)).toBeNull();
  });

  it('returns null when distance is zero or negative', () => {
    expect(computeDifficulty(500, 0)).toBeNull();
    expect(computeDifficulty(500, -1)).toBeNull();
  });

  // elevPerKm = elevationGainMeters * 1000 / distanceMeters
  it('classifies by elevation-per-kilometre thresholds', () => {
    expect(computeDifficulty(500, 100_000)).toBe('Easy'); // 5 m/km
    expect(computeDifficulty(100, 10_000)).toBe('Moderate'); // 10 m/km (lower bound)
    expect(computeDifficulty(200, 10_000)).toBe('Hard'); // 20 m/km (lower bound)
    expect(computeDifficulty(400, 10_000)).toBe('Extreme'); // 40 m/km (lower bound)
  });
});

describe('fmtElevation', () => {
  it('rounds and appends metres', () => {
    expect(fmtElevation(1234.6)).toBe('1235 m');
    expect(fmtElevation(89.4)).toBe('89 m');
    expect(fmtElevation(0)).toBe('0 m');
  });
});

describe('fmtDurationShort', () => {
  it('omits the hour segment when under one hour', () => {
    expect(fmtDurationShort(0)).toBe('0m');
    expect(fmtDurationShort(65)).toBe('1m');
    expect(fmtDurationShort(3599)).toBe('59m');
  });

  it('renders hours and minutes once over a hour', () => {
    expect(fmtDurationShort(3600)).toBe('1h 0m');
    expect(fmtDurationShort(3725)).toBe('1h 2m'); // 1h 2m 5s
  });
});

describe('haversineDistance', () => {
  it('is zero for the same point', () => {
    expect(haversineDistance(0, 0, 0, 0)).toBe(0);
    expect(haversineDistance(12.3, 45.6, 12.3, 45.6)).toBe(0);
  });

  it('returns ~111.19 km for one degree of longitude at the equator', () => {
    // 1 deg longitude on the equator ≈ 111_194.9 m (R * pi/180)
    const d = haversineDistance(0, 0, 0, 1);
    expect(Math.abs(d - 111_195)).toBeLessThan(100);
  });

  it('is symmetric in its arguments', () => {
    const a = haversineDistance(51.5074, -0.1278, 48.8566, 2.3522); // London → Paris
    const b = haversineDistance(48.8566, 2.3522, 51.5074, -0.1278); // Paris → London
    expect(a).toBe(b);
  });

  it('grows with angular separation', () => {
    const near = haversineDistance(0, 0, 0, 1);
    const far = haversineDistance(0, 0, 0, 2);
    expect(far).toBeGreaterThan(near);
  });
});
