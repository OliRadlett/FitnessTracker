import { describe, it, expect } from 'vitest';
import { daylightPhase, solarPosition, sunDirection } from '@/lib/sun';

describe('solarPosition', () => {
  it('is high at noon in midsummer London', () => {
    const p = solarPosition(new Date('2026-06-21T12:00:00Z'), 51.5, -0.13);
    expect(p.elevationDeg).toBeGreaterThan(55);
    expect(p.elevationDeg).toBeLessThan(68);
    // near solar noon the sun is due south
    expect(p.azimuthDeg).toBeGreaterThan(150);
    expect(p.azimuthDeg).toBeLessThan(210);
  });

  it('is below the horizon at midnight', () => {
    const p = solarPosition(new Date('2026-12-21T00:00:00Z'), 51.5, -0.13);
    expect(p.elevationDeg).toBeLessThan(0);
  });

  it('returns a unit direction vector pointing up when the sun is overhead', () => {
    const [x, y, z] = sunDirection({ elevationDeg: 90, azimuthDeg: 0 });
    expect(x).toBeCloseTo(0, 6);
    expect(y).toBeCloseTo(0, 6);
    expect(z).toBeCloseTo(1, 6);
  });

  it('points east when the sun is due east on the horizon', () => {
    const [x, y] = sunDirection({ elevationDeg: 0, azimuthDeg: 90 });
    expect(x).toBeCloseTo(1, 6);
    expect(y).toBeCloseTo(0, 6);
  });
});

describe('daylightPhase', () => {
  it('classifies night, golden and day', () => {
    expect(daylightPhase(-10)).toBe('night');
    expect(daylightPhase(3)).toBe('golden');
    expect(daylightPhase(40)).toBe('day');
  });
});
