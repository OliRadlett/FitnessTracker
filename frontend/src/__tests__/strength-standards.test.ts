import { describe, expect, it } from 'vitest';
import {
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
