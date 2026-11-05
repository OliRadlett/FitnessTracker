import { describe, expect, it } from 'vitest';

import type {
  CalendarActivity,
  CalendarDay,
  CalendarLift,
  CalendarPlanDay,
  CalendarResponse,
  CalendarWeek,
} from '@/lib/api';
import {
  dayStatus,
  insightForDay,
  isoDate,
  loggedCount,
  monthSummary,
  monthWeeks,
  planState,
  unplannedActivities,
} from '@/lib/calendar';

function plan(over: Partial<CalendarPlanDay> = {}): CalendarPlanDay {
  return {
    id: 'day-1',
    date: '2026-09-19',
    sport: 'strength',
    planned_type: 'easy',
    planned_tss: null,
    planned_duration_min: 60,
    planned_focus: 'pull',
    planned_exercises: null,
    planned_volume_kg: null,
    planned_rpe: null,
    planned_power_watts: null,
    planned_zone: null,
    workout_description: null,
    completed: true,
    actual_activity_id: null,
    actual_lifting_session_id: null,
    ...over,
  };
}

function activity(over: Partial<CalendarActivity> = {}): CalendarActivity {
  return {
    id: 'act-1',
    date: '2026-09-19',
    start_date: '2026-09-19T08:00:00Z',
    sport_type: 'cycling',
    name: 'Cycling',
    duration_seconds: 3600,
    distance_meters: 40000,
    tss: 40,
    tss_source: 'power',
    average_power: 180,
    normalized_power: 190,
    average_heartrate: 145,
    max_heartrate: 175,
    elevation_gain_meters: 300,
    calories: 600,
    source: 'strava',
    ride_context: null,
    ...over,
  };
}

function lift(over: Partial<CalendarLift> = {}): CalendarLift {
  return {
    id: 'lift-1',
    date: '2026-09-19',
    focus: 'Pull',
    program_name: null,
    duration_seconds: 3600,
    total_volume_kg: 6000,
    estimated_tss: 60,
    rpe_session: 7,
    set_count: 3,
    session_split: 'pull',
    session_class: 'volume_hypertrophy',
    sets: [],
    ...over,
  };
}

function day(over: Partial<CalendarDay> = {}): CalendarDay {
  return {
    date: '2026-09-19',
    plan: [],
    activities: [],
    lifts: [],
    metric: null,
    sleep: null,
    ...over,
  };
}

function week(over: Partial<CalendarWeek> = {}): CalendarWeek {
  return {
    week_start: '2026-09-14',
    week_end: '2026-09-20',
    iso_week: 38,
    planned_sessions: 0,
    completed_sessions: 0,
    target_sessions: 0,
    planned_tss: 0,
    actual_tss: 0,
    unplanned_actuals: 0,
    ...over,
  };
}

function response(days: CalendarDay[], over: Partial<CalendarResponse> = {}): CalendarResponse {
  return {
    range: { start: '2026-08-31', end: '2026-10-04' },
    today: '2026-09-20',
    plan: {
      id: 'plan-1',
      name: 'Post summer strength',
      start_date: '2026-08-24',
      end_date: '2027-01-10',
      status: 'active',
    },
    coverage: {
      planned_sessions: 0,
      target_sessions: 0,
      planned_tss: 0,
      strength_targets_missing: 0,
    },
    days,
    weeks: [week()],
    events: [],
    goals: [],
    current: null,
    unavailable: {},
    ...over,
  };
}

describe('calendar helpers', () => {
  it('builds a Monday-first month grid across the month boundary', () => {
    const weeks = monthWeeks(response([day()]), new Date(2026, 8, 1));
    expect(weeks).toHaveLength(5);
    expect(isoDate(weeks[0].weekStart)).toBe('2026-08-31');
    expect(isoDate(weeks[4].weekEnd)).toBe('2026-10-04');
    expect(weeks[0].days.filter((entry) => entry.inMonth)).toHaveLength(6);
  });

  it('marks a completed plan day with a linked lift as done', () => {
    const dayWithLift = day({ plan: [plan({ actual_lifting_session_id: 'lift-1' })], lifts: [lift()] });
    const state = planState(dayWithLift.plan[0], dayWithLift, '2026-09-20');
    expect(state.status).toBe('done');
    expect(state.actualTss).toBe(60);
  });

  it('marks a completed ride under target as partial', () => {
    const dayWithRide = day({
      plan: [plan({ sport: 'cycle', planned_tss: 100, actual_activity_id: 'act-1' })],
      activities: [activity({ tss: 40 })],
    });
    const state = planState(dayWithRide.plan[0], dayWithRide, '2026-09-20');
    expect(state.status).toBe('partial');
    expect(state.ratio).toBe(0.4);
  });

  it('surfaces a plan day linked to an actual on another date', () => {
    const planDay = plan({ date: '2026-09-14', actual_lifting_session_id: 'lift-1' });
    const linked = day({
      date: '2026-09-13',
      lifts: [lift({ date: '2026-09-13', id: 'lift-1' })],
    });
    const local = day({ date: '2026-09-14', plan: [planDay] });
    const state = planState(planDay, local, '2026-09-20', response([local, linked]));
    expect(state.status).toBe('mismatch');
    expect(state.offDate).toBe(true);
    expect(state.linkedDate).toBe('2026-09-13');
  });

  it('counts a paired strength activity and lift once', () => {
    const paired = day({
      activities: [activity({ sport_type: 'strength', tss: null })],
      lifts: [lift()],
    });
    expect(loggedCount(paired)).toBe(1);
    expect(unplannedActivities(paired)).toHaveLength(0);
    expect(dayStatus(paired, '2026-09-20')).toBe('unplanned');
  });

  it('reports coverage separately from actual load', () => {
    const days = [
      day({
        plan: [
          plan({ id: 'strength', planned_tss: null, completed: true }),
          plan({ id: 'ride', sport: 'cycle', planned_tss: 100, completed: false }),
        ],
        activities: [activity()],
        lifts: [lift()],
      }),
    ];
    const summary = monthSummary(response(days), new Date(2026, 8, 1));
    expect(summary.plannedSessions).toBe(2);
    expect(summary.targetSessions).toBe(1);
    expect(summary.plannedTss).toBe(100);
    expect(summary.actualTss).toBe(100); // 40 ride + 60 lift
    expect(summary.compliance).toBe(0.5);
    expect(summary.targetCoverage).toBe(0.5);
  });

  it('explains an under-target day in the inspector insight', () => {
    const dayWithRide = day({
      plan: [plan({ sport: 'cycle', planned_tss: 100, actual_activity_id: 'act-1' })],
      activities: [activity({ tss: 44 })],
    });
    const insight = insightForDay(dayWithRide, '2026-09-20');
    expect(insight.tone).toBe('caution');
    expect(insight.title).toContain('Under target');
  });
});
