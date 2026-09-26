import { describe, it, expect } from 'vitest';
import { buildRaceRides, RACE_PALETTE, raceIndexAt, speedColor, type RacePoint } from '@/lib/raceRides';
import type { ActivityStream } from '@/lib/api';

describe('buildRaceRides', () => {
  it('returns empty for no rides', () => {
    expect(buildRaceRides({ history: { rides: [], personal_best: null }, detailById: {} })).toEqual([]);
  });

  it('skips rides missing polyline or velocity', () => {
    const out = buildRaceRides({
      history: {
        rides: [{ activity_id: 'a1', date: '2026-01-01', duration_seconds: 60, distance_meters: 1000, average_power: 200, tss: 30 }],
        personal_best: null,
      },
      detailById: { a1: { name: 'Ride', streams: [] } },
    });
    expect(out).toEqual([]);
  });

  it('sorts most recent first and assigns palette colours', () => {
    const detailById: Record<string, { name: string; encoded_polyline?: string; streams: ActivityStream[] }> = {
      old: { name: 'Old', encoded_polyline: '_p~iF~ps|U_ulLnnqC_mqNvxq`@', streams: [{ id: '1', activity_id: 'old', stream_type: 'velocity', data: { data: [5, 6, 7, 8] }, resolution: 1 }] },
      recent: { name: 'Recent', encoded_polyline: '_p~iF~ps|U_ulLnnqC_mqNvxq`@', streams: [{ id: '2', activity_id: 'recent', stream_type: 'velocity', data: { data: [5, 6, 7, 8] }, resolution: 1 }] },
    };
    const rides = buildRaceRides({
      history: {
        rides: [
          { activity_id: 'old', date: '2025-01-01', duration_seconds: 60, distance_meters: 1000, average_power: 200, tss: 30 },
          { activity_id: 'recent', date: '2026-06-01', duration_seconds: 60, distance_meters: 1000, average_power: 250, tss: 35 },
        ],
        personal_best: { activity_id: 'recent' },
      },
      detailById,
    });
    expect(rides.length).toBe(2);
    expect(rides[0].id).toBe('recent'); // most recent first
    expect(rides[1].id).toBe('old');
    expect(rides[0].color).toBe(RACE_PALETTE[0]);
    expect(rides[1].color).toBe(RACE_PALETTE[1]);
    expect(rides[0].isPr).toBe(true);
    expect(rides[1].isPr).toBe(false);
  });
});

describe('raceIndexAt', () => {
  const pts: RacePoint[] = [
    { x: 0, y: 0, z: 0, distance: 0, speed: 5, elapsed: 0 },
    { x: 10, y: 0, z: 0, distance: 10, speed: 5, elapsed: 2 },
    { x: 20, y: 0, z: 0, distance: 20, speed: 5, elapsed: 4 },
    { x: 30, y: 0, z: 0, distance: 30, speed: 5, elapsed: 6 },
  ];

  it('finds the exact index', () => {
    expect(raceIndexAt(pts, 0)).toBe(0);
    expect(raceIndexAt(pts, 2)).toBe(1);
    expect(raceIndexAt(pts, 4)).toBe(2);
  });

  it('clamps outside the range', () => {
    expect(raceIndexAt(pts, -5)).toBe(0);
    expect(raceIndexAt(pts, 999)).toBe(3);
  });

  it('finds the floor for in-between times', () => {
    expect(raceIndexAt(pts, 3)).toBe(1);
    expect(raceIndexAt(pts, 5.9)).toBe(2);
  });
});

describe('speedColor', () => {
  it('maps slow to blue-ish, fast to red-ish', () => {
    const [sr, , sb] = speedColor(0, 10);
    const [fr, , fb] = speedColor(10, 10);
    expect(sb).toBeGreaterThan(fb); // slow has more blue
    expect(fr).toBeGreaterThan(sr); // fast has more red
  });

  it('clamps outside the range', () => {
    const [r0] = speedColor(-5, 10);
    const [r1] = speedColor(50, 10);
    expect(r0).toBeGreaterThan(0);
    expect(r1).toBeGreaterThan(0);
  });
});
