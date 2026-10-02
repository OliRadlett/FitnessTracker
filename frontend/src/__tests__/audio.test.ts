import { describe, it, expect } from 'vitest';
import { heartPeriodFor, rumbleGainFor, windFreqFor, windGainFor } from '@/lib/audio';

describe('windGainFor', () => {
  it('is silent crawling and caps at a rush', () => {
    expect(windGainFor(0)).toBe(0);
    expect(windGainFor(2)).toBe(0);
    expect(windGainFor(12)).toBeGreaterThan(0);
    expect(windGainFor(100)).toBe(0.25);
  });

  it('never NaNs on garbage input', () => {
    expect(windGainFor(Number.NaN)).toBe(0);
    expect(windGainFor(-5)).toBe(0);
  });
});

describe('heartPeriodFor', () => {
  it('converts bpm to seconds per beat inside the human range', () => {
    expect(heartPeriodFor(60)).toBeCloseTo(1, 6);
    expect(heartPeriodFor(120)).toBeCloseTo(0.5, 6);
    expect(heartPeriodFor(180)).toBeCloseTo(1 / 3, 6);
  });

  it('yields no beat without usable HR', () => {
    expect(heartPeriodFor(null)).toBeNull();
    expect(heartPeriodFor(undefined)).toBeNull();
    expect(heartPeriodFor(Number.NaN)).toBeNull();
    expect(heartPeriodFor(20)).toBeNull();
    expect(heartPeriodFor(300)).toBeNull();
  });
});

describe('rumbleGainFor', () => {
  it('stays texture-quiet: silent crawling, capped well under the wind', () => {
    expect(rumbleGainFor(0)).toBe(0);
    expect(rumbleGainFor(3)).toBe(0);
    expect(rumbleGainFor(9)).toBeGreaterThan(0);
    expect(rumbleGainFor(100)).toBe(0.05);
    expect(rumbleGainFor(100)).toBeLessThan(windGainFor(100));
  });

  it('never NaNs on garbage input', () => {
    expect(rumbleGainFor(Number.NaN)).toBe(0);
    expect(rumbleGainFor(-5)).toBe(0);
  });
});

describe('windFreqFor', () => {
  it('brightens with speed from a dull floor', () => {
    expect(windFreqFor(0)).toBe(300);
    expect(windFreqFor(10)).toBe(700);
    expect(windFreqFor(20)).toBeGreaterThan(windFreqFor(10));
  });

  it('falls back to the floor on garbage input', () => {
    expect(windFreqFor(Number.NaN)).toBe(300);
  });
});
