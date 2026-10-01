import { describe, it, expect } from 'vitest';
import {
  applyWeatherLight,
  daylightPhase,
  solarPosition,
  sunDirection,
  sunLightModel,
} from '@/lib/sun';

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

  it('names blue hour between night and sunrise', () => {
    expect(daylightPhase(-6)).toBe('blue');
    expect(daylightPhase(-3)).toBe('blue');
    expect(daylightPhase(-0.1)).toBe('blue');
    expect(daylightPhase(0)).toBe('golden');
    expect(daylightPhase(-6.1)).toBe('night');
  });
});

describe('sunLightModel', () => {
  it('hits the authored anchors', () => {
    const night = sunLightModel(-18);
    expect(night.phase).toBe('night');
    expect(night.sunIntensity).toBeCloseTo(0.3, 6);
    expect(night.headlamp).toBe(1);
    const golden = sunLightModel(5);
    expect(golden.phase).toBe('golden');
    expect(golden.sunIntensity).toBeCloseTo(1.6, 6);
    expect(golden.hemiIntensity).toBeCloseTo(0.7, 6);
    expect(golden.headlamp).toBe(0);
    const day = sunLightModel(40);
    expect(day.phase).toBe('day');
    expect(day.sunIntensity).toBeCloseTo(1.4, 6);
    expect(day.hemiIntensity).toBeCloseTo(0.9, 6);
    expect(day.exposure).toBeCloseTo(1.0, 6);
    expect(day.headlamp).toBe(0);
  });

  it('is continuous — no cliffs anywhere in the sweep', () => {
    // Bound is far below the old cliff size (a ~0.9 jump in one step) but
    // above the steepest authored ramp (sunrise ≈0.15 per half-degree).
    let prev = sunLightModel(-18);
    for (let e = -17.5; e <= 60; e += 0.5) {
      const cur = sunLightModel(e);
      expect(Math.abs(cur.sunIntensity - prev.sunIntensity)).toBeLessThan(0.2);
      expect(Math.abs(cur.hemiIntensity - prev.hemiIntensity)).toBeLessThan(0.2);
      expect(Math.abs(cur.exposure - prev.exposure)).toBeLessThan(0.2);
      expect(Math.abs(cur.headlamp - prev.headlamp)).toBeLessThan(0.2);
      expect(cur.phase).toBe(daylightPhase(e));
      prev = cur;
    }
  });

  it('fades the headlamp out by sunrise', () => {
    expect(sunLightModel(-6).headlamp).toBeGreaterThan(0.5);
    expect(sunLightModel(0).headlamp).toBeLessThan(0.3);
  });
});

describe('applyWeatherLight', () => {
  const clear = { overcast: false, rainy: false, snowy: false, foggy: false };

  it('is identity under clear skies', () => {
    const base = sunLightModel(20);
    expect(applyWeatherLight(base, clear)).toEqual(base);
  });

  it('dims the sun and exposure in rain', () => {
    const base = sunLightModel(20);
    const out = applyWeatherLight(base, { ...clear, rainy: true });
    expect(out.sunIntensity).toBeLessThan(base.sunIntensity);
    expect(out.exposure).toBeCloseTo(base.exposure * 0.9, 6);
  });
});
