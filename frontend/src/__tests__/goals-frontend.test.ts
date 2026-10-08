import { describe, expect, it } from 'vitest';
import {
  formatGoalValue,
  goalAlignmentBadge,
  goalDisplayBadge,
  goalProgressPct,
  isCyclingMetric,
  isLiftingMetric,
} from '../components/ui/GoalCard';
import type { Goal, GoalProjectionResponse } from '../lib/api';

function goal(over: Partial<Goal>): Goal {
  return {
    id: 'g1',
    user_id: 'u1',
    metric: 'estimated_1rm',
    target_value: 200,
    status: 'active',
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    ...over,
  } as Goal;
}

function projection(badge: string): GoalProjectionResponse {
  return { badge } as unknown as GoalProjectionResponse;
}

describe('goalProgressPct', () => {
  it('prefers the backend value, clamped to 0–100', () => {
    expect(goalProgressPct(goal({ progress_pct: 42.4 }))).toBeCloseTo(42.4);
    expect(goalProgressPct(goal({ progress_pct: 140 }))).toBe(100);
    expect(goalProgressPct(goal({ progress_pct: -5 }))).toBe(0);
  });

  it('computes direction-aware fill for increase goals', () => {
    // start 100 → target 200, current 150 = 50%
    expect(
      goalProgressPct(goal({ starting_value: 100, current_value: 150, target_value: 200 })),
    ).toBeCloseTo(50);
  });

  it('computes direction-aware fill for decrease goals', () => {
    // start 100 → target 80, current 90 = 50%
    expect(
      goalProgressPct(goal({ starting_value: 100, current_value: 90, target_value: 80 })),
    ).toBeCloseTo(50);
  });

  it('is 0 without a start/current trajectory', () => {
    expect(goalProgressPct(goal({}))).toBe(0);
  });
});

describe('goalAlignmentBadge', () => {
  it('grades ahead / on-track / behind / regressing', () => {
    expect(goalAlignmentBadge(goal({ target_date: '2026-12-31', alignment_pct: 110 }))?.label).toBe('Ahead');
    expect(goalAlignmentBadge(goal({ target_date: '2026-12-31', alignment_pct: 90 }))?.label).toBe('On track');
    expect(goalAlignmentBadge(goal({ target_date: '2026-12-31', alignment_pct: 40 }))?.label).toBe('Behind');
    expect(goalAlignmentBadge(goal({ target_date: '2026-12-31', alignment_pct: -3 }))?.label).toBe('Regressing');
  });

  it('is null without a target date or alignment', () => {
    expect(goalAlignmentBadge(goal({ alignment_pct: 120 }))).toBeNull();
    expect(goalAlignmentBadge(goal({ target_date: '2026-12-31' }))).toBeNull();
  });
});

describe('goalDisplayBadge precedence (card ≡ modal)', () => {
  const g = goal({ target_date: '2026-12-31', alignment_pct: 120 });

  it('projection badge wins over alignment when regression has data', () => {
    expect(goalDisplayBadge(g, projection('At Risk'))?.label).toBe('At Risk');
  });

  it('falls back to alignment on "Not enough data"', () => {
    expect(goalDisplayBadge(g, projection('Not enough data'))?.label).toBe('Ahead');
  });

  it('falls back to alignment without a projection', () => {
    expect(goalDisplayBadge(g, null)?.label).toBe('Ahead');
  });
});

describe('formatGoalValue', () => {
  it('renders counts as integers', () => {
    expect(formatGoalValue(4.0, 'count')).toBe('4 count');
  });

  it('renders measures with one decimal', () => {
    expect(formatGoalValue(180, 'kg')).toBe('180.0 kg');
  });
});

describe('lifting/cycling classification (two-way cross-links)', () => {
  it('recognises lifting metrics by key or strength sport', () => {
    expect(isLiftingMetric(goal({ metric: 'estimated_1rm' }))).toBe(true);
    expect(isLiftingMetric(goal({ metric: 'big3_total' }))).toBe(true);
    expect(isLiftingMetric(goal({ metric: 'squat_bw_ratio' }))).toBe(true);
    expect(isLiftingMetric(goal({ metric: 'weekly_sessions', filter_json: { sport: 'strength' } }))).toBe(true);
    expect(isLiftingMetric(goal({ metric: 'ftp_watts' }))).toBe(false);
  });

  it('recognises cycling metrics by key or cycling sport', () => {
    expect(isCyclingMetric(goal({ metric: 'ftp_watts' }))).toBe(true);
    expect(isCyclingMetric(goal({ metric: 'weekly_sessions', filter_json: { sport: 'cycling' } }))).toBe(true);
    expect(isCyclingMetric(goal({ metric: 'estimated_1rm' }))).toBe(false);
  });
});
