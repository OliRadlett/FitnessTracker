import { describe, expect, it } from 'vitest';
import {
  autoregulate,
  nextSessionSuggestion,
  whatIfWeeks,
} from '@/lib/prescription';
import type { BriefVerdict } from '@/lib/brief';

const greenVerdict: BriefVerdict = {
  verdict: 'green',
  headline: 'Green light',
  signals: [],
};

describe('nextSessionSuggestion', () => {
  it('rests on red verdicts', () => {
    const s = nextSessionSuggestion({
      verdict: { verdict: 'red', headline: 'x', signals: [] },
      sleepDebtHours: 6,
      windy: false,
      hot: false,
      plannedSport: 'cycle',
      plannedTss: 120,
    });
    expect(s.title).toContain('Rest');
    expect(s.detail).toContain('easy');
  });

  it('trims volume on sleep debt and notes wind', () => {
    const s = nextSessionSuggestion({
      verdict: greenVerdict,
      sleepDebtHours: 4,
      windy: true,
      hot: false,
      plannedSport: 'cycle',
      plannedTss: 100,
    });
    expect(s.detail).toContain('Cut volume');
    expect(s.detail).toContain('Windy');
  });
});

describe('autoregulate', () => {
  it('adds load on easy RPE', () => {
    const a = autoregulate({ name: 'Squat', lastWeightKg: 100, lastReps: 5, lastRpe: 6.5 });
    expect(a.deltaKg).toBe(2.5);
    expect(a.suggestedWeightKg).toBe(102.5);
  });

  it('drops load on grinder RPE', () => {
    const a = autoregulate({ name: 'Bench', lastWeightKg: 80, lastReps: 5, lastRpe: 9.5 });
    expect(a.deltaKg).toBe(-2.5);
    expect(a.suggestedWeightKg).toBe(77.5);
  });

  it('holds without data', () => {
    const a = autoregulate({ name: 'Row', lastWeightKg: null, lastReps: null, lastRpe: null });
    expect(a.deltaKg).toBe(0);
  });
});

describe('whatIfWeeks', () => {
  it('computes weeks at current slope', () => {
    expect(whatIfWeeks(250, 270, 2)).toBe(10);
  });

  it('handles decrease goals', () => {
    expect(whatIfWeeks(80, 75, -0.5)).toBe(10);
  });

  it('returns null on flat or opposing trends', () => {
    expect(whatIfWeeks(250, 270, 0)).toBeNull();
    expect(whatIfWeeks(250, 270, -1)).toBeNull();
    expect(whatIfWeeks(250, 250, 2)).toBe(0);
  });
});
