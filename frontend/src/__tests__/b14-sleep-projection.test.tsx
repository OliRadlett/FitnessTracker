import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ChartData } from '@/lib/api';
import {
  projectionCaption,
  withProjection,
  type MetricTrend,
} from '@/lib/projection';
import { SleepDebtCard } from '@/components/health/SleepDebtCard';

const base: ChartData = {
  chart_type: 'line',
  title: 'FTP History',
  labels: ['2026-07-01', '2026-08-01'],
  series: [{ name: 'FTP (W)', data: [240, 250], color: '#f59e0b' }],
};

const trend: MetricTrend = {
  metric: 'ftp_watts',
  current_value: 250,
  trend: { slope_per_day: 0.1, slope_per_week: 0.7, r_squared: 0.9, data_points: 12 },
  classification: 'increasing',
  history: [
    { date: '2026-07-01', value: 240 },
    { date: '2026-08-01', value: 250 },
  ],
  projection_line: [
    { date: '2026-08-08', value: 251 },
    { date: '2026-08-15', value: 252 },
  ],
};

describe('withProjection', () => {
  it('appends a dashed forecast series and extends labels', () => {
    const merged = withProjection(base, trend, 'FTP forecast');
    expect(merged.labels).toEqual(['2026-07-01', '2026-08-01', '2026-08-08', '2026-08-15']);
    expect(merged.series).toHaveLength(2);
    const forecast = merged.series[1];
    expect(forecast.name).toBe('FTP forecast');
    expect(forecast.dashed).toBe(true);
    // History range is null-padded; junction anchors at the last base label.
    expect(forecast.data.slice(0, 2)).toEqual([null, 250]);
    expect(forecast.data.slice(2)).toEqual([251, 252]);
    // Base series is null-padded for the extension, not otherwise touched.
    expect(merged.series[0].data).toEqual([240, 250, null, null]);
  });

  it('returns the base chart unchanged when there is nothing to project', () => {
    expect(withProjection(base, undefined, 'X')).toBe(base);
    expect(withProjection(base, { ...trend, projection_line: [] }, 'X')).toBe(base);
  });

  it('labels the caption with the sample window', () => {
    expect(projectionCaption(trend)).toContain('R² 0.90');
  });
});

describe('SleepDebtCard', () => {
  it('renders debt, average, and short days', () => {
    render(
      <SleepDebtCard
        data={{
          debt_hours: 4.5,
          avg_sleep_hours: 6.8,
          days_below_target: 3,
          target_hours: 8,
          window_days: 7,
        }}
      />,
    );
    expect(screen.getByText('-4.5h')).toBeDefined();
    expect(screen.getByText(/Avg 6.8h vs 8h target/)).toBeDefined();
    expect(screen.getByText(/3d short/)).toBeDefined();
  });

  it('shows caught-up state when debt is zero', () => {
    render(
      <SleepDebtCard
        data={{
          debt_hours: 0,
          avg_sleep_hours: 8.2,
          days_below_target: 0,
          target_hours: 8,
          window_days: 7,
        }}
      />,
    );
    expect(screen.getByText('Caught up')).toBeDefined();
  });
});
