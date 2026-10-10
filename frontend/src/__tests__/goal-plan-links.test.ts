import { describe, expect, it } from 'vitest';
import {
  buildPlanDayHref,
  dayMatchesGoal,
  describePlanMatch,
  goalsForPlanDay,
  matchGoalPlanDays,
} from '../components/goals/goalPlanLinks';
import type { Goal, TrainingPlanDay } from '../lib/api';

function goal(over: Partial<Goal>): Goal {
  return {
    id: 'g1',
    user_id: 'u1',
    metric: 'estimated_1rm',
    target_value: 100,
    status: 'active',
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    ...over,
  } as Goal;
}

function day(over: Partial<TrainingPlanDay>): TrainingPlanDay {
  return {
    id: 'd1',
    plan_id: 'p1',
    day_date: '2026-12-01',
    sport: 'strength',
    planned_type: 'moderate',
    completed: false,
    ...over,
  } as TrainingPlanDay;
}

const squatGoal = goal({ metric: 'estimated_1rm', filter_json: { exercise: 'Back Squat' } });
const pushDay = day({
  id: 'push',
  day_date: '2026-12-01',
  planned_focus: 'push',
  planned_exercises: [{ exercise: 'Back Squat', sets: 5, reps: 5 }],
});
const pullDay = day({
  id: 'pull',
  day_date: '2026-12-03',
  planned_focus: 'pull',
  planned_exercises: [{ exercise: 'Deadlift', sets: 3, reps: 5 }],
});
const rideDay = day({ id: 'ride', day_date: '2026-12-02', sport: 'cycle', planned_type: 'easy' });
const restDay = day({ id: 'rest', day_date: '2026-12-04', sport: 'rest', planned_type: 'rest' });
const pullDayWithSquat = day({
  id: 'pullsq',
  day_date: '2026-12-05',
  planned_focus: 'pull',
  planned_exercises: [{ exercise: 'Back Squat', sets: 3, reps: 8 }],
});

describe('dayMatchesGoal', () => {
  it('matches an exercise-scoped goal to days programming that exercise', () => {
    expect(dayMatchesGoal(squatGoal, pushDay)).toBe(true);
    expect(dayMatchesGoal(squatGoal, pullDay)).toBe(false);
  });

  it('matches short filters against longer exercise names and vice versa', () => {
    const short = goal({ filter_json: { exercise: 'Squat' } });
    expect(dayMatchesGoal(short, pushDay)).toBe(true);
  });

  it('never matches rest days', () => {
    expect(dayMatchesGoal(squatGoal, restDay)).toBe(false);
    expect(dayMatchesGoal(goal({ metric: 'weekly_sessions' }), restDay)).toBe(false);
  });

  it('matches strength-scoped goals to any strength day', () => {
    const g = goal({ metric: 'estimated_1rm', filter_json: { sport: 'strength' } });
    expect(dayMatchesGoal(g, pushDay)).toBe(true);
    expect(dayMatchesGoal(g, pullDay)).toBe(true);
    expect(dayMatchesGoal(g, rideDay)).toBe(false);
  });

  it('matches cycling goals to cycle days only', () => {
    const g = goal({ metric: 'ftp_watts' });
    expect(dayMatchesGoal(g, rideDay)).toBe(true);
    expect(dayMatchesGoal(g, pushDay)).toBe(false);
  });

  it('matches generic session goals to any training day', () => {
    const g = goal({ metric: 'weekly_sessions' });
    expect(dayMatchesGoal(g, pushDay)).toBe(true);
    expect(dayMatchesGoal(g, rideDay)).toBe(true);
  });
});

describe('matchGoalPlanDays', () => {
  it('returns upcoming matches earliest-first, excluding past days', () => {
    const past = day({ id: 'past', day_date: '2026-11-01', planned_exercises: [{ exercise: 'Back Squat', sets: 5, reps: 5 }] });
    const out = matchGoalPlanDays(squatGoal, [pullDay, pushDay, past, rideDay], '2026-11-15');
    expect(out.map((d) => d.id)).toEqual(['push']);
  });
});

describe('describePlanMatch', () => {
  it('reads focus-dominated strength matches in the plan vocabulary ("3 push days")', () => {
    const days = [
      pushDay,
      day({ id: 'p2', day_date: '2026-12-08', planned_focus: 'push', planned_exercises: [{ exercise: 'Back Squat', sets: 3, reps: 3 }] }),
      day({ id: 'p3', day_date: '2026-12-10', planned_focus: 'push', planned_exercises: [{ exercise: 'Back Squat', sets: 5, reps: 3 }] }),
    ];
    expect(describePlanMatch(squatGoal, days)).toBe('3 push days');
  });

  it('labels a single focus match as a day, not a session', () => {
    expect(describePlanMatch(squatGoal, [pushDay])).toBe('1 push day');
  });

  it('falls back to the exercise name without a dominant focus', () => {
    const mixed = [
      pushDay,
      pullDayWithSquat,
    ];
    expect(describePlanMatch(squatGoal, mixed)).toBe('2 Back Squat sessions');
  });

  it('counts cycling matches as rides', () => {
    expect(describePlanMatch(goal({ metric: 'ftp_watts' }), [rideDay, rideDay])).toBe('2 rides');
  });
});

describe('goalsForPlanDay', () => {
  it('returns only active goals relevant to the day', () => {
    const archived = goal({ id: 'old', status: 'expired', filter_json: { exercise: 'Back Squat' } });
    const ftp = goal({ id: 'ftp', metric: 'ftp_watts', target_value: 250 });
    expect(goalsForPlanDay([squatGoal, archived, ftp], pushDay).map((g) => g.id)).toEqual(['g1']);
  });
});

describe('buildPlanDayHref', () => {
  it('deep-links to the plan day without touching other params', () => {
    expect(buildPlanDayHref('p1', '2026-12-01')).toBe('/training?plan=p1&day=2026-12-01');
    expect(buildPlanDayHref('p1', '2026-12-01T00:00:00')).toBe('/training?plan=p1&day=2026-12-01');
  });
});
