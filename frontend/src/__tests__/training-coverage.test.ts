import { describe, expect, it } from 'vitest';

import type {
  AdaptiveSuggestionsResponse,
  PlanReviewResponse,
  TrainingPlan,
  TrainingPlanDay,
  TrainingWeekDay,
} from '@/lib/api';
import {
  formatWeekRuns,
  lastWrittenWeek,
  planCoverage,
  planStopsBefore,
  planVerdict,
  readDay,
  unwrittenRuns,
  weekDates,
} from '@/lib/training/coverage';

/**
 * The regression this file exists for.
 *
 * The old page showed `completed_days / day_count`. On the owner's real plan that
 * was `47/49 · 96%` — beside `Week 11 of 20` and a date range to 2027-01-10 —
 * while the plan's authored days stopped at 2026-10-15. Every authored day was
 * ticked, so the page reported a plan that had run dry as nearly finished.
 *
 * These cases are built from that plan's real shape: 2026-08-24 → 2027-01-10,
 * 49 authored days, the last of them on 2026-10-15.
 */

const day = (day_date: string, sport: string, completed = true): TrainingPlanDay =>
  ({
    id: `d-${day_date}`,
    plan_id: 'p1',
    day_date,
    sport,
    completed,
    planned_type: sport === 'rest' ? 'rest' : 'moderate',
    planned_tss: null,
    planned_duration_min: null,
    workout_description: null,
    planned_focus: null,
    planned_exercises: null,
    planned_volume_kg: null,
    planned_rpe: null,
    planned_power_watts: null,
    planned_zone: null,
    planned_route_id: null,
    lifting_session_id: null,
    warmup_template_id: null,
    notes: null,
    created_at: '2026-08-24T00:00:00Z',
    activity_id: null,
    wahoo_plan_id: null,
    wahoo_workout_id: null,
    wahoo_route_id: null,
    wahoo_pushed_at: null,
    wahoo_push_workout: false,
    wahoo_push_route: false,
  }) as TrainingPlanDay;

/** 8 written weeks (24 Aug – 18 Oct), stopping mid-week 8 on 15 Oct. */
function realShapedPlan(): TrainingPlan {
  const days: TrainingPlanDay[] = [];
  // Weeks 1–7 complete, week 8 written Mon–Thu only.
  for (let w = 0; w < 7; w += 1) {
    for (let d = 0; d < 7; d += 1) {
      const date = new Date(Date.UTC(2026, 7, 24 + w * 7 + d));
      const iso = date.toISOString().slice(0, 10);
      days.push(day(iso, d === 2 || d === 6 ? 'rest' : 'strength'));
    }
  }
  for (const iso of ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15']) {
    days.push(day(iso, iso === '2026-10-12' ? 'rest' : 'strength'));
  }
  return {
    id: 'p1',
    user_id: 'u1',
    name: 'Post summer strength',
    start_date: '2026-08-24',
    end_date: '2027-01-10',
    plan_type: 'custom',
    status: 'active',
    event_id: null,
    created_at: '2026-08-24T00:00:00Z',
    updated_at: '2026-08-24T00:00:00Z',
    days,
  } as TrainingPlan;
}

const TODAY = '2026-11-03';

describe('planCoverage', () => {
  const plan = realShapedPlan();
  const cov = planCoverage(plan, TODAY);

  it('counts weeks, not authored days', () => {
    expect(cov.totalWeeks).toBe(20);
    expect(cov.writtenWeeks).toBe(8);
    expect(cov.uncoveredWeeks).toBe(12);
  });

  it('reports where the written plan stops and how stale it is', () => {
    expect(cov.lastSessionDate).toBe('2026-10-15');
    expect(cov.daysSinceLastSession).toBe(19);
    expect(cov.firstUnwrittenWeek).toBe(9);
  });

  it('separates sessions from rest days', () => {
    expect(cov.sessions).toBe(plan.days.filter((d) => d.sport !== 'rest').length);
    expect(cov.restDays).toBe(plan.days.filter((d) => d.sport === 'rest').length);
    // Every authored day is exactly one of the two — the invariant, not a count.
    expect(cov.sessions + cov.restDays).toBe(plan.days.length);
  });

  it('marks the week that contains today as current', () => {
    const current = cov.weeks.filter((w) => w.isCurrent);
    expect(current).toHaveLength(1);
    expect(current[0].weekNumber).toBe(11);
    expect(current[0].written).toBe(false);
  });

  it('never presents a ratio over 1 for a plan that ran dry', () => {
    // The old page printed 47/49 = 96% here. Coverage must read 8/20 = 40%.
    expect(cov.writtenWeeks / cov.totalWeeks).toBeCloseTo(0.4);
  });
});

describe('planStopsBefore', () => {
  it('is true when nothing is authored after the given date', () => {
    expect(planStopsBefore(realShapedPlan(), '2026-11-03')).toBe(true);
    expect(planStopsBefore(realShapedPlan(), '2026-10-10')).toBe(false);
  });

  it('is true for an empty plan', () => {
    expect(planStopsBefore({ ...realShapedPlan(), days: [] } as TrainingPlan, '2026-10-01')).toBe(true);
  });
});

describe('weekDates', () => {
  it('returns the seven calendar dates of a week, written or not', () => {
    expect(weekDates('2026-08-24', 11)).toEqual([
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
      '2026-11-05',
      '2026-11-06',
      '2026-11-07',
      '2026-11-08',
    ]);
  });
});

describe('unwrittenRuns / formatWeekRuns', () => {
  /** The owner's live plan once sessions were added: 1–8 written, 9–10 empty, 11 written. */
  const withHole = () => {
    const plan = realShapedPlan();
    return {
      ...plan,
      days: [
        ...plan.days,
        { ...plan.days[0], day_date: '2026-11-03', id: 'd-11-1' },
        { ...plan.days[0], day_date: '2026-11-06', id: 'd-11-2' },
      ],
    } as TrainingPlan;
  };

  it('names a hole, not a tail', () => {
    // The old copy said "Weeks 9–20 are empty", false from week 11 onward.
    const cov = planCoverage(withHole(), TODAY);
    const runs = unwrittenRuns(cov);
    expect(runs[0]).toEqual({ start: 9, end: 10 });
    expect(formatWeekRuns(runs)).toBe('weeks 9–10 and 12–20');
  });

  it('collapses a contiguous tail into one run', () => {
    const cov = planCoverage(realShapedPlan(), TODAY);
    expect(formatWeekRuns(unwrittenRuns(cov))).toBe('weeks 9–20');
  });

  it('uses the singular for a single empty week', () => {
    expect(formatWeekRuns([{ start: 3, end: 3 }])).toBe('week 3');
  });

  it('joins two runs with "and"', () => {
    expect(
      formatWeekRuns([
        { start: 9, end: 10 },
        { start: 12, end: 20 },
      ]),
    ).toBe('weeks 9–10 and 12–20');
  });
});

describe('lastWrittenWeek', () => {
  it('is the week the content reaches, not the count of written weeks', () => {
    const plan = realShapedPlan();
    const withHole = {
      ...plan,
      days: [...plan.days, { ...plan.days[0], day_date: '2026-11-06', id: 'd-11' }],
    } as TrainingPlan;
    const cov = planCoverage(withHole, TODAY);

    // 9 weeks written, but the content reaches week 11 — a count-based boundary
    // sits at week 9, before a week that has sessions.
    expect(cov.writtenWeeks).toBe(9);
    expect(lastWrittenWeek(cov, withHole)).toBe(11);
  });
});

describe('readDay', () => {
  const base = {
    id: 'x',
    plan_id: 'p1',
    day_date: '2026-10-07',
    sport: 'strength',
    completed: true,
    planned_type: 'hard',
    planned_tss: null,
    planned_duration_min: 60,
    workout_description: 'Volume block week 4 - 4x7@rpe8.5',
    planned_focus: 'squat',
    planned_exercises: null,
    planned_volume_kg: null,
    planned_rpe: 8.5,
    planned_power_watts: null,
    planned_zone: null,
    planned_route_id: null,
    lifting_session_id: null,
    warmup_template_id: null,
    notes: null,
    created_at: '2026-10-01T00:00:00Z',
    activity_id: null,
    wahoo_plan_id: null,
    wahoo_workout_id: null,
    wahoo_route_id: null,
    wahoo_pushed_at: null,
    wahoo_push_workout: false,
    wahoo_push_route: false,
    day_status: 'completed',
    actual_lifting_session: {
      id: 'l1',
      session_date: '2026-10-07',
      focus: 'Legs',
      total_volume_kg: 7368.5,
    },
  } as TrainingWeekDay;

  it('prefers the actual over the plan, and keeps the plan as the subtitle', () => {
    const r = readDay('2026-10-07', base, TODAY);
    expect(r.status).toBe('done');
    expect(r.title).toBe('Legs session');
    expect(r.headline).toEqual({ value: '7.4', unit: 't' });
    expect(r.planned).toBe('Volume block week 4 - 4x7@rpe8.5');
  });

  it('shows no number for a missed day — the absence is the point', () => {
    const { actual_lifting_session, ...noActual } = base;
    const r = readDay('2026-10-10', { ...noActual, day_status: 'missed' }, TODAY);
    expect(r.status).toBe('missed');
    expect(r.headline).toBeNull();
    expect(r.planned).toBe('Volume block week 4 - 4x7@rpe8.5');
  });

  it('returns a gap row for a date the plan never wrote', () => {
    const r = readDay('2026-11-04', undefined, TODAY);
    expect(r.status).toBe('gap');
    expect(r.title).toBe('No session');
    expect(r.headline).toBeNull();
  });

  it('marks today specifically when there is no day at all', () => {
    expect(readDay(TODAY, undefined, TODAY).status).toBe('today');
  });
});

describe('planVerdict', () => {
  const live = (over: Partial<AdaptiveSuggestionsResponse>): AdaptiveSuggestionsResponse => ({
    generated_at: '2026-11-03T17:04:00Z',
    plan_id: 'p1',
    plan_name: 'Post summer strength',
    fatigue: 'balanced',
    summary: 'Signals are balanced — stick to the plan.',
    axes: [
      {
        key: 'load',
        title: 'Fitness vs fatigue',
        stance: 'maintain',
        severity: 'info',
        guidance: 'TSB -3 is in the healthy band.',
      },
    ],
    suggestions: [],
    ...over,
  });

  const snapshot = (over: Partial<PlanReviewResponse> = {}): PlanReviewResponse =>
    ({
      week_start: '2026-11-02',
      generated_at: '2026-11-02T06:15:00Z',
      plan_name: 'Post summer strength',
      load: { ctl: 22.1, atl: 25.3, tsb: -3.2 },
      conformity: { overall_pct: 87.2, trend: 'improving', patterns: [] },
      adaptive: { summary: null, fatigue: 'rest', axes: [], suggestions: [] },
      missed_days: 1,
      missed_dates: ['2026-10-10'],
      upcoming_days: 0,
      active_goals: 0,
      ...over,
    }) as PlanReviewResponse;

  it('surfaces a pending health axis as the action, not as a second headline', () => {
    const v = planVerdict(
      live({
        axes: [
          ...live({}).axes,
          { key: 'health', title: 'Health alerts', stance: 'rest', severity: 'warning', guidance: '7 active health alerts pending.' },
        ],
      }),
      snapshot(),
    );
    expect(v.action).toEqual({ label: 'Open Health', href: '/health' });
    expect(v.tone).toBe('caution');
    expect(v.headline.toLowerCase()).toContain('health');
  });

  it('says nothing to change when the only signal is a balanced load', () => {
    const v = planVerdict(live({}), snapshot({ adaptive: { summary: null, fatigue: 'balanced', axes: [], suggestions: [] } as PlanReviewResponse['adaptive'] }));
    expect(v.headline).toContain('Nothing to change');
    expect(v.action).toBeNull();
    expect(v.conflict).toBeNull();
  });

  it('names a disagreement once instead of printing two verdicts', () => {
    const v = planVerdict(live({}), snapshot());
    expect(v.conflict).not.toBeNull();
    expect(v.conflict?.snapshot).toBe('rest');
    expect(v.conflict?.live).toBe('balanced');
    // The footnote is data; the headline is singular.
    expect(v.headline).toBe('Nothing to change — the load is in the healthy band');
  });
});
