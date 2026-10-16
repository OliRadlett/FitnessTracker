import { describe, expect, it } from 'vitest';

import type { PlanReviewResponse } from '@/lib/api/types';
import {
  buildWeekAheadModel,
  formatLoadLabel,
  formatShortDate,
  formatWeekLabel,
} from '@/components/training/weekAhead';

function review(overrides: Partial<PlanReviewResponse> = {}): PlanReviewResponse {
  return {
    week_start: '2026-08-03',
    generated_at: '2026-08-03T06:00:00Z',
    plan_name: 'Base Building Block',
    load: { ctl: 48.4, atl: 43.1, tsb: 5.2 },
    conformity: { overall_pct: 72, trend: 'stable', patterns: [] },
    adaptive: { summary: 'Hold the build.', fatigue: 'fresh', axes: [], suggestions: [] },
    missed_days: 2,
    missed_dates: ['2026-08-05', '2026-08-07'],
    upcoming_days: 3,
    active_goals: 1,
    ...overrides,
  };
}

describe('buildWeekAheadModel — degraded sections', () => {
  it('renders with load, conformity and adaptive all null', () => {
    const model = buildWeekAheadModel(
      review({ load: null, conformity: null, adaptive: null }),
    );

    expect(model.loadLabel).toBeNull();
    expect(model.conformityLabel).toBeNull();
    expect(model.adaptiveSummary).toBeNull();
    expect(model.unavailable).toEqual(['load', 'conformity', 'adaptive advice']);
  });

  it('still carries the week, day counts and goals when every section is null', () => {
    const model = buildWeekAheadModel(
      review({ load: null, conformity: null, adaptive: null, active_goals: 4 }),
    );

    expect(model.weekLabel).toBe('Week of 3 Aug 2026');
    expect(model.missedDays).toBe(2);
    expect(model.missedDatesLabel).toBe('5 Aug, 7 Aug');
    expect(model.upcomingDays).toBe(3);
    expect(model.activeGoals).toBe(4);
  });

  it('names only the sections that degraded', () => {
    const model = buildWeekAheadModel(review({ conformity: null }));

    expect(model.unavailable).toEqual(['conformity']);
    expect(model.loadLabel).toBe('CTL 48 · ATL 43 · TSB +5');
    expect(model.adaptiveSummary).toBe('Hold the build.');
  });

  it('reports no unavailable sections when all three are present', () => {
    expect(buildWeekAheadModel(review()).unavailable).toEqual([]);
  });
});

describe('buildWeekAheadModel — fields', () => {
  it('formats the load figures, keeping TSB signed', () => {
    const model = buildWeekAheadModel(
      review({ load: { ctl: 48.4, atl: 43.1, tsb: -12.6 } }),
    );

    expect(model.loadLabel).toBe('CTL 48 · ATL 43 · TSB -13');
  });

  it('renders a present-but-unscored conformity as "not scored"', () => {
    const model = buildWeekAheadModel(
      review({ conformity: { overall_pct: null, trend: null, patterns: [] } }),
    );

    expect(model.conformityLabel).toBe('not scored');
    expect(model.unavailable).toEqual([]);
  });

  it('marks a truncated missed-date list', () => {
    const model = buildWeekAheadModel(
      review({
        missed_days: 12,
        missed_dates: ['2026-08-05', '2026-08-07'],
      }),
    );

    expect(model.missedDatesLabel).toBe('5 Aug, 7 Aug…');
  });

  it('has no missed label when nothing was missed', () => {
    const model = buildWeekAheadModel(review({ missed_days: 0, missed_dates: [] }));

    expect(model.missedDatesLabel).toBeNull();
  });
});

describe('date and load formatters', () => {
  it('formats a week label without a timezone shift', () => {
    expect(formatWeekLabel('2026-01-05')).toBe('Week of 5 Jan 2026');
  });

  it('formats a short date', () => {
    expect(formatShortDate('2026-12-31')).toBe('31 Dec');
  });

  it('passes an unparseable date through', () => {
    expect(formatWeekLabel('not-a-date')).toBe('not-a-date');
    expect(formatShortDate('2026-08')).toBe('2026-08');
  });

  it('rounds load figures', () => {
    expect(formatLoadLabel({ ctl: 48.4, atl: 43.6, tsb: 0 })).toBe('CTL 48 · ATL 44 · TSB +0');
  });
});
