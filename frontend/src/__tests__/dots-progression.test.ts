import { describe, expect, it } from 'vitest';
import { joinDotsProgression } from '../components/lifting/DotsProgressionCard';
import type { WeightEntry } from '../lib/api';

function entry(date: string, weight_kg: number): WeightEntry {
  return { id: date, date, weight_kg, source: 'manual' };
}

describe('joinDotsProgression', () => {
  it('joins totals to the latest weigh-in on or before each date', () => {
    const { labels, data } = joinDotsProgression(
      ['2026-06-01', '2026-07-01', '2026-08-01'],
      [400, 420, 440],
      [entry('2026-05-20', 90), entry('2026-07-15', 89)],
    );
    expect(labels).toEqual(['2026-06-01', '2026-07-01', '2026-08-01']);
    // June + July use 90kg (denominator ≈ 773.27 — same figure the 387.96
    // reference pins); August uses 89kg (denominator ≈ 768.90).
    expect(data[0]).toBeCloseTo(258.6, 0);
    expect(data[1]).toBeCloseTo(271.6, 0);
    expect(data[2]).toBeCloseTo(286.1, 0);
  });

  it('skips total dates with no prior weigh-in instead of guessing', () => {
    const { labels, data } = joinDotsProgression(
      ['2026-06-01', '2026-08-01'],
      [400, 440],
      [entry('2026-07-01', 90)],
    );
    expect(labels).toEqual(['2026-08-01']);
    expect(data).toHaveLength(1);
  });

  it('skips null totals', () => {
    const { labels, data } = joinDotsProgression(
      ['2026-06-01', '2026-07-01'],
      [null, 420],
      [entry('2026-05-01', 90)],
    );
    expect(labels).toEqual(['2026-07-01']);
    expect(data).toHaveLength(1);
  });

  it('returns empty when there is no bodyweight history', () => {
    expect(joinDotsProgression(['2026-06-01'], [400], [])).toEqual({
      labels: [],
      data: [],
    });
  });
});
