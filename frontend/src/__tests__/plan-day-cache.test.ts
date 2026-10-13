import { describe, expect, it } from 'vitest';

import type { TrainingPlan, TrainingWeekDay, TrainingWeekResponse } from '@/lib/api';
import {
  patchDayInPlan,
  patchDayInWeek,
  removeDayFromWeek,
  swapDaysInWeek,
  upsertDayInWeek,
} from '@/lib/training/planDayCache';

function weekDay(
  id: string,
  day_date: string,
  extra: Partial<TrainingWeekDay> = {},
): TrainingWeekDay {
  return {
    id,
    plan_id: 'p1',
    day_date,
    sport: 'cycle',
    planned_type: 'easy',
    completed: false,
    ...extra,
  };
}

function week(days: TrainingWeekDay[]): TrainingWeekResponse {
  return {
    plan_id: 'p1',
    week_number: 1,
    week_start: days[0]?.day_date ?? '2026-01-05',
    week_end: '2026-01-11',
    days,
  };
}

function plan(days: TrainingWeekDay[]): TrainingPlan {
  return {
    id: 'p1',
    user_id: 'u1',
    name: 'Build',
    start_date: '2026-01-05',
    end_date: '2026-02-01',
    plan_type: 'build',
    status: 'active',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    days,
  };
}

describe('patchDayInWeek', () => {
  it('merges the patch into the target day only', () => {
    const w = week([weekDay('a', '2026-01-05'), weekDay('b', '2026-01-06')]);
    const out = patchDayInWeek(w, 'b', { planned_tss: 123, notes: 'hard' });
    expect(out?.days[1].planned_tss).toBe(123);
    expect(out?.days[1].notes).toBe('hard');
    expect(out?.days[0].planned_tss).toBeUndefined();
  });

  it('leaves every day untouched for an unknown id', () => {
    const w = week([weekDay('a', '2026-01-05')]);
    const out = patchDayInWeek(w, 'zzz', { notes: 'x' });
    expect(out?.days[0].notes).toBeUndefined();
  });

  it('returns undefined for undefined input', () => {
    expect(patchDayInWeek(undefined, 'a', { notes: 'x' })).toBeUndefined();
  });
});

describe('patchDayInPlan', () => {
  it('merges the patch into the target day only', () => {
    const p = plan([weekDay('a', '2026-01-05'), weekDay('b', '2026-01-06')]);
    const out = patchDayInPlan(p, 'a', { completed: true });
    expect(out?.days[0].completed).toBe(true);
    expect(out?.days[1].completed).toBe(false);
  });

  it('returns undefined for undefined input', () => {
    expect(patchDayInPlan(undefined, 'a', { completed: true })).toBeUndefined();
  });
});

describe('swapDaysInWeek', () => {
  it('exchanges the two dates and keeps the ids', () => {
    const w = week([weekDay('a', '2026-01-05'), weekDay('b', '2026-01-07')]);
    const out = swapDaysInWeek(w, 'a', 'b');
    expect(out?.days.find((d) => d.id === 'a')?.day_date).toBe('2026-01-07');
    expect(out?.days.find((d) => d.id === 'b')?.day_date).toBe('2026-01-05');
  });

  it('is a no-op (same reference) when either day is outside the week', () => {
    const w = week([weekDay('a', '2026-01-05')]);
    expect(swapDaysInWeek(w, 'a', 'b')).toBe(w);
  });
});

describe('removeDayFromWeek', () => {
  it('drops the target day', () => {
    const w = week([weekDay('a', '2026-01-05'), weekDay('b', '2026-01-06')]);
    expect(removeDayFromWeek(w, 'a')?.days.map((d) => d.id)).toEqual(['b']);
  });

  it('leaves the week intact for an unknown id', () => {
    const w = week([weekDay('a', '2026-01-05')]);
    expect(removeDayFromWeek(w, 'zzz')?.days).toHaveLength(1);
  });
});

describe('upsertDayInWeek', () => {
  it('inserts a new day in date order', () => {
    const w = week([weekDay('a', '2026-01-05'), weekDay('c', '2026-01-09')]);
    const out = upsertDayInWeek(w, weekDay('b', '2026-01-07'));
    expect(out?.days.map((d) => d.id)).toEqual(['a', 'b', 'c']);
  });

  it('replaces an existing day rather than duplicating it', () => {
    const w = week([weekDay('a', '2026-01-05'), weekDay('b', '2026-01-06')]);
    const out = upsertDayInWeek(w, weekDay('b', '2026-01-06', { notes: 'updated' }));
    expect(out?.days).toHaveLength(2);
    expect(out?.days.find((d) => d.id === 'b')?.notes).toBe('updated');
  });
});
