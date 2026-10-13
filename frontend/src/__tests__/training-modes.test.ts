import { describe, expect, it } from 'vitest';

import type { TrainingPlanSummary } from '@/lib/api';
import {
  isIsoDate,
  parseTrainingMode,
  pickActivePlan,
} from '@/lib/training/trainingModes';

function plan(over: Partial<TrainingPlanSummary>): TrainingPlanSummary {
  return {
    id: 'p',
    name: 'P',
    start_date: '2026-01-05',
    end_date: '2026-02-02',
    plan_type: 'build',
    status: 'active',
    day_count: 7,
    completed_days: 0,
    ...over,
  };
}

describe('parseTrainingMode', () => {
  it('passes through known modes', () => {
    expect(parseTrainingMode('plan')).toBe('plan');
    expect(parseTrainingMode('review')).toBe('review');
    expect(parseTrainingMode('peaks')).toBe('peaks');
    expect(parseTrainingMode('plans')).toBe('plans');
  });

  it('defaults absent/unknown values to plan', () => {
    expect(parseTrainingMode(null)).toBe('plan');
    expect(parseTrainingMode(undefined)).toBe('plan');
    expect(parseTrainingMode('')).toBe('plan');
    expect(parseTrainingMode('analytics')).toBe('plan');
  });
});

describe('isIsoDate', () => {
  it('accepts YYYY-MM-DD only', () => {
    expect(isIsoDate('2026-01-05')).toBe(true);
    expect(isIsoDate('2026-1-5')).toBe(false);
    expect(isIsoDate('tomorrow')).toBe(false);
    expect(isIsoDate('')).toBe(false);
    expect(isIsoDate(null)).toBe(false);
  });
});

describe('pickActivePlan', () => {
  it('returns the most recently updated active plan', () => {
    const older = plan({ id: 'a', updated_at: '2026-01-01T00:00:00Z' });
    const newer = plan({ id: 'b', updated_at: '2026-02-01T00:00:00Z' });
    expect(pickActivePlan([older, newer])?.id).toBe('b');
  });

  it('falls back to start_date when updated_at is missing', () => {
    const older = plan({ id: 'a', start_date: '2026-01-05' });
    const newer = plan({ id: 'b', start_date: '2026-03-05' });
    expect(pickActivePlan([older, newer])?.id).toBe('b');
  });

  it('ignores non-active plans', () => {
    const draft = plan({ id: 'd', status: 'draft', updated_at: '2026-09-01T00:00:00Z' });
    const active = plan({ id: 'a', status: 'active', updated_at: '2026-01-01T00:00:00Z' });
    expect(pickActivePlan([draft, active])?.id).toBe('a');
  });

  it('returns null when nothing is active', () => {
    expect(pickActivePlan([plan({ status: 'draft' })])).toBeNull();
    expect(pickActivePlan([])).toBeNull();
  });
});
