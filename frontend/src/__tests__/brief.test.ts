import { describe, expect, it } from 'vitest';
import { computeVerdict, insightOneLiner, pickTopInsight } from '@/lib/brief';

describe('computeVerdict', () => {
  it('goes green when all signals are good', () => {
    const v = computeVerdict({ recoveryScore: 82, tsb: 4, sleepDebtHours: 0.5 });
    expect(v.verdict).toBe('green');
    expect(v.signals).toHaveLength(3);
    expect(v.headline).toContain('Green light');
  });

  it('takes the worst signal and names the limiter', () => {
    const v = computeVerdict({ recoveryScore: 78, tsb: 2, sleepDebtHours: 6 });
    expect(v.verdict).toBe('red');
    expect(v.headline).toContain('sleep debt');
  });

  it('goes yellow on moderate fatigue', () => {
    const v = computeVerdict({ recoveryScore: 60, tsb: -15, sleepDebtHours: 1 });
    expect(v.verdict).toBe('yellow');
  });

  it('handles missing data honestly', () => {
    const v = computeVerdict({ recoveryScore: null, tsb: null, sleepDebtHours: null });
    expect(v.verdict).toBe('yellow');
    expect(v.headline).toContain('Not enough data');
  });
});

describe('pickTopInsight', () => {
  const insights = [
    { insight_type: 'power_norms', confidence: 'low', sample_size: 20, data: null },
    { insight_type: 'sleep_performance', confidence: 'medium', sample_size: 9, data: null },
    { insight_type: 'tsb_peak', confidence: 'high', sample_size: 30, data: null },
  ];

  it('prefers sleep insight when debt is high', () => {
    expect(pickTopInsight(insights, 3)?.insight_type).toBe('sleep_performance');
  });

  it('otherwise picks highest confidence', () => {
    expect(pickTopInsight(insights, 0)?.insight_type).toBe('tsb_peak');
  });

  it('returns null when empty', () => {
    expect(pickTopInsight([], 0)).toBeNull();
  });
});

describe('insightOneLiner', () => {
  it('summarises sleep bands', () => {
    expect(
      insightOneLiner({
        insight_type: 'sleep_performance',
        confidence: 'medium',
        sample_size: 9,
        data: { bands: [{ band: '7h+', avg_np_ftp: 0.912 }] },
      }),
    ).toContain('7h+');
  });
});
