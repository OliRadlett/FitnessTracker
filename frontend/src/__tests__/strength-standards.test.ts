import { describe, expect, it } from 'vitest';
import {
  dots,
  levelForRatio,
  nextLevelTarget,
  ratioToBodyweight,
  standardKeyFor,
} from '../lib/lifting/standards';

describe('standardKeyFor', () => {
  it('matches canonical names exactly', () => {
    expect(standardKeyFor('Back Squat')).toBe('Back Squat');
    expect(standardKeyFor('Bench Press')).toBe('Bench Press');
    expect(standardKeyFor('Deadlift')).toBe('Deadlift');
  });

  it('falls back to keyword match for variations', () => {
    expect(standardKeyFor('High-Bar Squat')).toBe('Back Squat');
    expect(standardKeyFor('Close-Grip Bench Press')).toBe('Bench Press');
    expect(standardKeyFor('Romanian Deadlift')).toBe('Deadlift');
  });

  it('returns null for non-Big-3 lifts', () => {
    expect(standardKeyFor('Barbell Curl')).toBeNull();
    expect(standardKeyFor('Overhead Press')).toBeNull();
  });
});

describe('ratioToBodyweight', () => {
  it('divides e1RM by bodyweight', () => {
    expect(ratioToBodyweight(150, 100)).toBe(1.5);
  });

  it('is null-safe', () => {
    expect(ratioToBodyweight(null, 100)).toBeNull();
    expect(ratioToBodyweight(150, null)).toBeNull();
    expect(ratioToBodyweight(150, 0)).toBeNull();
  });
});

describe('levelForRatio', () => {
  it('awards the highest met threshold', () => {
    expect(levelForRatio('Back Squat', 1.6)).toBe('intermediate');
    expect(levelForRatio('Back Squat', 2.0)).toBe('advanced');
    expect(levelForRatio('Bench Press', 1.0)).toBe('intermediate');
    expect(levelForRatio('Deadlift', 3.2)).toBe('elite');
  });

  it('falls back to beginner below every threshold', () => {
    expect(levelForRatio('Back Squat', 0.8)).toBe('beginner');
  });
});

describe('nextLevelTarget', () => {
  it('returns the next multiplier up', () => {
    expect(nextLevelTarget('Back Squat', 'intermediate')).toBe(2.0);
    expect(nextLevelTarget('Bench Press', 'beginner')).toBe(1.0);
  });

  it('returns null at elite', () => {
    expect(nextLevelTarget('Deadlift', 'elite')).toBeNull();
  });
});

describe('dots', () => {
  it('scores a 500kg total at 100kg male (hand-verified reference)', () => {
    // Denominator: -109.30 + 739.1293 - 1918.759221 + 2409.00756 - 307.75076
    // = 812.326879 → 250000 / 812.326879 ≈ 307.76. If this fails, the
    // constants drifted — do not "fix" the test, re-confirm the polynomial.
    expect(dots(500, 100, 'male')).toBeCloseTo(307.76, 1);
  });

  it('matches the 90kg / 600kg reference (387.96)', () => {
    expect(dots(600, 90, 'male')).toBeCloseTo(387.96, 1);
  });

  it('matches the 63kg / 350kg female reference (376.43)', () => {
    expect(dots(350, 63, 'female')).toBeCloseTo(376.43, 1);
  });

  it('rewards lighter lifters for the same total', () => {
    const at100 = dots(500, 100, 'male')!;
    const at83 = dots(500, 83, 'male')!;
    expect(at83).toBeGreaterThan(at100);
  });

  it('is null-safe', () => {
    expect(dots(null, 100)).toBeNull();
    expect(dots(500, null)).toBeNull();
    expect(dots(500, 0)).toBeNull();
    expect(dots(-10, 100)).toBeNull();
  });
});
