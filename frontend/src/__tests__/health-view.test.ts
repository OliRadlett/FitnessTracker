import { describe, expect, it } from 'vitest';
import { latestSeriesValue, parseInsight } from '@/components/health/healthView';

describe('health view helpers', () => {
  it('returns the last non-null value in a series', () => {
    const chart = {
      chart_type: 'line' as const,
      title: '',
      labels: ['a', 'b', 'c'],
      series: [{ name: 'Sleep Hours', data: [7.1, null, 7.8] }],
    };
    expect(latestSeriesValue(chart, 'Sleep Hours')).toBe(7.8);
    expect(latestSeriesValue(chart, 'Efficiency %')).toBeNull();
  });

  it('does not treat an n=4 correlation as trusted', () => {
    const result = parseInsight('Better recovery → lower volume (strong link, r=-0.50, n=4).');
    expect(result.n).toBe(4);
    expect(result.trusted).toBe(false);
  });

  it('accepts a correlation at n=10', () => {
    expect(parseInsight('link (r=-0.27, n=10).').trusted).toBe(true);
  });
});
