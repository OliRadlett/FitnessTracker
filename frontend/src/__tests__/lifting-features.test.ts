import { describe, expect, it } from 'vitest';
import { computePlates } from '../lib/lifting/plates';
import { setsToCsv } from '../lib/lifting/csv';
import { suggestedRestSeconds } from '../lib/lifting/rest';
import { normaliseExerciseKey } from '../lib/lifting/reference';

describe('computePlates', () => {
  it('loads a round number exactly', () => {
    const r = computePlates(100, 20); // 40kg/side = 25 + 15
    expect(r.perSide).toBe(40);
    expect(r.counts).toEqual([
      { plate: 25, count: 1 },
      { plate: 15, count: 1 },
    ]);
    expect(r.leftover).toBe(0);
    expect(r.totalPlates).toBe(2);
  });

  it('uses small plates for fractional loads', () => {
    const r = computePlates(102.5, 20); // 41.25/side = 25 + 15 + 1.25
    expect(r.counts).toEqual([
      { plate: 25, count: 1 },
      { plate: 15, count: 1 },
      { plate: 1.25, count: 1 },
    ]);
    expect(r.leftover).toBe(0);
  });

  it('handles a lighter bar and a just-the-bar target', () => {
    expect(computePlates(60, 15).perSide).toBe(22.5);
    const bar = computePlates(20, 20);
    expect(bar.counts).toEqual([]);
    expect(bar.leftover).toBe(0);
  });

  it('reports an unreachable remainder', () => {
    const r = computePlates(61, 20); // 20.5/side = 20 + 0.5 (no 0.5 plate)
    expect(r.counts).toEqual([{ plate: 20, count: 1 }]);
    expect(r.leftover).toBeCloseTo(0.5, 5);
  });

  it('never returns negative load for a target below the bar', () => {
    const r = computePlates(10, 20);
    expect(r.perSide).toBe(0);
    expect(r.counts).toEqual([]);
  });
});

describe('setsToCsv', () => {
  it('emits a header and one row per set', () => {
    const csv = setsToCsv([
      {
        exercise_name: 'Back Squat',
        set_number: 1,
        weight_kg: 100,
        reps: 5,
        rpe: 8,
        is_warmup: false,
      },
      {
        exercise_name: 'Back Squat',
        set_number: 2,
        weight_kg: 40,
        reps: 8,
        is_warmup: true,
      },
    ]);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('exercise,set_number,weight_kg,reps,rpe,warmup');
    expect(lines[1]).toBe('Back Squat,1,100,5,8,no');
    expect(lines[2]).toBe('Back Squat,2,40,8,,yes');
  });

  it('quotes values containing commas or quotes', () => {
    const csv = setsToCsv([
      {
        exercise_name: 'Squat, paused',
        set_number: 1,
        weight_kg: 100,
        reps: 5,
        is_warmup: false,
      },
    ]);
    expect(csv.split('\r\n')[1]).toBe('"Squat, paused",1,100,5,,no');
  });
});

describe('suggestedRestSeconds', () => {
  it('extends rest when recovery is low or readiness is red', () => {
    expect(suggestedRestSeconds(20)).toBe(210);
    expect(suggestedRestSeconds(80, 'red')).toBe(210);
  });

  it('shortens rest when recovery is high or readiness is green', () => {
    expect(suggestedRestSeconds(80)).toBe(120);
    expect(suggestedRestSeconds(50, 'green')).toBe(120);
  });

  it('lets a low recovery score override a green label (conservative)', () => {
    expect(suggestedRestSeconds(20, 'green')).toBe(210);
  });

  it('falls back to a middle default', () => {
    expect(suggestedRestSeconds(50)).toBe(150);
    expect(suggestedRestSeconds(null, 'unknown')).toBe(150);
  });
});

describe('normaliseExerciseKey', () => {
  it('matches snake_case plan names to free-typed names', () => {
    expect(normaliseExerciseKey('Back_Squat')).toBe('back squat');
    expect(normaliseExerciseKey('  Bench-Press ')).toBe('bench press');
    expect(normaliseExerciseKey('Overhead   Press')).toBe('overhead press');
  });
});
