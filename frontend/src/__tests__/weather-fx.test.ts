import { describe, it, expect } from 'vitest';
import { classifyWeather, parseCardinal, windsockPose } from '@/lib/three/weather';

describe('parseCardinal', () => {
  it('maps cardinals to degrees', () => {
    expect(parseCardinal('N')).toBe(0);
    expect(parseCardinal('E')).toBe(90);
    expect(parseCardinal('S')).toBe(180);
    expect(parseCardinal('W')).toBe(270);
    expect(parseCardinal('NNE')).toBe(22);
  });

  it('is case-insensitive and falls back to 0', () => {
    expect(parseCardinal('sw')).toBe(225);
    expect(parseCardinal(null)).toBe(0);
    expect(parseCardinal('calm')).toBe(0);
  });
});

describe('classifyWeather', () => {
  it('is clear by default', () => {
    const w = classifyWeather(null, null);
    expect(w.weatherType).toBeNull();
    expect(w.wetness).toBe(0);
    expect(w.overcast).toBe(false);
  });

  it('detects rain from precipitation or conditions', () => {
    expect(classifyWeather('sunny', 3).rainy).toBe(true);
    expect(classifyWeather('light rain', 0).rainy).toBe(true);
    const w = classifyWeather('rain', 2);
    expect(w.weatherType).toBe('rain');
    expect(w.wetness).toBeGreaterThan(0.5);
  });

  it('prefers snow over rain and haze over nothing', () => {
    expect(classifyWeather('snow', 1).weatherType).toBe('snow');
    expect(classifyWeather('mist', 0).weatherType).toBe('haze');
  });

  it('flags overcast only when dry and cloudy', () => {
    expect(classifyWeather('overcast', 0).overcast).toBe(true);
    expect(classifyWeather('overcast', 5).overcast).toBe(false);
  });

  it('scales intensity with precipitation', () => {
    const light = classifyWeather('rain', 0.5);
    const heavy = classifyWeather('rain', 6);
    expect(heavy.precipIntensity).toBeGreaterThan(light.precipIntensity);
  });
});

describe('windsockPose', () => {
  it('hides without wind data or in calm air', () => {
    expect(windsockPose(0, 'SW')).toBeNull();
    expect(windsockPose(null, 'SW')).toBeNull();
    expect(windsockPose(undefined, 'SW')).toBeNull();
    expect(windsockPose(18, null)).toBeNull();
    expect(windsockPose(18, undefined)).toBeNull();
  });

  it('points downwind: from the west blows east (+X)', () => {
    expect(windsockPose(18, 'W')!.rotationZ).toBeCloseTo(0, 5);
  });

  it('from the east blows west', () => {
    expect(Math.abs(windsockPose(18, 'E')!.rotationZ)).toBeCloseTo(Math.PI, 5);
  });

  it('lifts with speed', () => {
    expect(windsockPose(40, 'SW')!.lift).toBeGreaterThan(windsockPose(18, 'SW')!.lift);
  });
});
