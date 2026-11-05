import {
  addDays,
  endOfMonth,
  endOfWeek,
  format,
  getISOWeek,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import type {
  CalendarActivity as Activity,
  CalendarDay as Day,
  CalendarEvent as EventRow,
  CalendarGoal as GoalRow,
  CalendarLift as Lift,
  CalendarPlanDay as PlanDay,
  CalendarResponse as Fixture,
  CalendarWeek as Week,
} from '@/lib/api';

export type Status =
  | 'done'
  | 'partial'
  | 'missed'
  | 'mismatch'
  | 'planned'
  | 'rest'
  | 'unplanned'
  | 'quiet'
  | 'done-unlogged';

export type Tone = 'good' | 'caution' | 'bad' | 'info' | 'muted';

export interface PlanState {
  status: Status;
  plannedTss: number | null;
  actualTss: number;
  ratio: number | null;
  activity?: Activity;
  lift?: Lift;
  /** The linked actual's date when it is not this plan day's date. */
  linkedDate?: string;
  offDate: boolean;
}

export interface MonthSummary {
  plannedSessions: number;
  completedSessions: number;
  evidenceSessions: number;
  targetSessions: number;
  plannedTss: number;
  actualTss: number;
  activityCount: number;
  liftCount: number;
  restDays: number;
  missed: number;
  mismatch: number;
  doneUnlogged: number;
  unplannedActuals: number;
  compliance: number | null;
  targetCoverage: number | null;
  hasPlan: boolean;
}

export interface MonthWeek {
  weekStart: Date;
  weekEnd: Date;
  days: { date: Date; day: Day | undefined; inMonth: boolean }[];
  summary: Week | undefined;
}

export function parseDate(value: string): Date {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function isoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function monthLabel(date: Date): string {
  return format(date, 'MMMM yyyy');
}

export function dayLabel(date: Date): string {
  return format(date, 'EEEE d MMMM');
}

export function shortDayLabel(date: Date): string {
  return format(date, 'EEE d');
}

export function weekLabel(start: Date, end: Date): string {
  return `${format(start, 'd MMM')} – ${format(end, 'd MMM')}`;
}

export function isoWeek(date: Date): number {
  return getISOWeek(date);
}

export function daysBetween(start: Date, end: Date): Date[] {
  const out: Date[] = [];
  let cursor = start;
  while (cursor <= end) {
    out.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return out;
}

export function getDay(fixture: Fixture, date: string): Day | undefined {
  return fixture.days.find((d) => d.date === date);
}

export function monthWeeks(fixture: Fixture, month: Date): MonthWeek[] {
  const monthStart = startOfMonth(month);
  const monthEnd = endOfMonth(month);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  const weeks: MonthWeek[] = [];
  let cursor = gridStart;
  while (cursor <= gridEnd) {
    const weekEnd = endOfWeek(cursor, { weekStartsOn: 1 });
    const days = daysBetween(cursor, weekEnd).map((date) => ({
      date,
      day: getDay(fixture, isoDate(date)),
      inMonth: date.getMonth() === month.getMonth(),
    }));
    const summary = fixture.weeks.find((w) => w.week_start === isoDate(cursor));
    weeks.push({ weekStart: cursor, weekEnd, days, summary });
    cursor = addDays(cursor, 7);
  }
  return weeks;
}

export function planState(
  plan: PlanDay,
  day: Day,
  today: string,
  fixture?: Fixture,
): PlanState {
  // Prefer the actual on this date; if the plan's FK points at a session on a
  // different date, surface that as an off-date link rather than "no evidence".
  const sameDayActivity = plan.actual_activity_id
    ? day.activities.find((a) => a.id === plan.actual_activity_id)
    : undefined;
  const sameDayLift = plan.actual_lifting_session_id
    ? day.lifts.find((l) => l.id === plan.actual_lifting_session_id)
    : undefined;
  const activity =
    sameDayActivity ??
    (plan.actual_activity_id && fixture
      ? findActivity(fixture, plan.actual_activity_id)
      : undefined);
  const lift =
    sameDayLift ??
    (plan.actual_lifting_session_id && fixture
      ? findLift(fixture, plan.actual_lifting_session_id)
      : undefined);
  const actualTss = (activity?.tss ?? 0) + (lift?.estimated_tss ?? 0);
  const plannedTss = plan.planned_tss ?? null;
  const ratio = plannedTss && plannedTss > 0 ? actualTss / plannedTss : null;
  const hasActual = Boolean(activity || lift);
  const linkedDate = activity?.date ?? lift?.date;
  const offDate = Boolean(linkedDate && linkedDate !== plan.date);

  if (plan.sport === 'rest') {
    return { status: 'rest', plannedTss, actualTss, ratio, activity, lift, linkedDate, offDate };
  }
  if (offDate) {
    return { status: 'mismatch', plannedTss, actualTss, ratio, activity, lift, linkedDate, offDate };
  }
  if (plan.completed && hasActual) {
    const status: Status =
      ratio !== null && (ratio < 0.8 || ratio > 1.2) ? 'partial' : 'done';
    return { status, plannedTss, actualTss, ratio, activity, lift, linkedDate, offDate };
  }
  if (plan.completed && !hasActual) {
    return { status: 'done-unlogged', plannedTss, actualTss, ratio, activity, lift, linkedDate, offDate };
  }
  if (!plan.completed && hasActual) {
    return { status: 'mismatch', plannedTss, actualTss, ratio, activity, lift, linkedDate, offDate };
  }
  return {
    status: plan.date < today ? 'missed' : 'planned',
    plannedTss,
    actualTss,
    ratio,
    activity,
    lift,
    linkedDate,
    offDate,
  };
}

export function planStates(day: Day, today: string, fixture?: Fixture): PlanState[] {
  return day.plan.map((p) => planState(p, day, today, fixture));
}

export function dayStatus(day: Day, today: string, fixture?: Fixture): Status {
  const states = planStates(day, today, fixture);
  const nonRest = states.filter((s) => s.status !== 'rest');
  const actuals = day.activities.length + day.lifts.length > 0;
  if (nonRest.length === 0) {
    if (actuals) return 'unplanned';
    if (states.some((s) => s.status === 'rest')) return 'rest';
    return 'quiet';
  }
  const order: Status[] = [
    'mismatch',
    'missed',
    'partial',
    'done-unlogged',
    'done',
    'planned',
  ];
  for (const status of order) {
    if (nonRest.some((s) => s.status === status)) return status;
  }
  return actuals ? 'unplanned' : 'quiet';
}

export function statusLabel(status: Status): string {
  switch (status) {
    case 'done':
      return 'On plan';
    case 'partial':
      return 'Off target';
    case 'missed':
      return 'Missed';
    case 'mismatch':
      return 'Unconfirmed';
    case 'planned':
      return 'Planned';
    case 'rest':
      return 'Rest';
    case 'unplanned':
      return 'Unplanned';
    case 'done-unlogged':
      return 'Marked done';
    default:
      return 'Quiet';
  }
}

export function statusTone(status: Status): Tone {
  if (status === 'done') return 'good';
  if (status === 'partial' || status === 'mismatch' || status === 'done-unlogged') {
    return 'caution';
  }
  if (status === 'missed') return 'bad';
  if (status === 'planned') return 'info';
  if (status === 'unplanned') return 'info';
  return 'muted';
}

export function unplannedActivities(day: Day): Activity[] {
  const linked = new Set(
    day.plan.map((p) => p.actual_activity_id).filter(Boolean) as string[],
  );
  // A strength activity is the same training session as the lifting session
  // logged on that date; the lift carries the richer data, so don't count the
  // paired activity as a second unplanned session.
  return day.activities.filter(
    (a) => !linked.has(a.id) && !(a.sport_type === 'strength' && day.lifts.length > 0),
  );
}

export function unplannedLifts(day: Day): Lift[] {
  const linked = new Set(
    day.plan.map((p) => p.actual_lifting_session_id).filter(Boolean) as string[],
  );
  return day.lifts.filter((l) => !linked.has(l.id));
}

/**
 * Number of distinct logged training sessions on a day. A strength activity
 * and a lifting session on the same date describe the same session; counting
 * both would double the day.
 */
export function loggedCount(day: Day): number {
  const strengthActivities = day.lifts.length
    ? day.activities.filter((a) => a.sport_type === 'strength').length
    : 0;
  return day.activities.length + day.lifts.length - strengthActivities;
}

export function recoveryTone(score: number | null | undefined): Tone | 'none' {
  if (score == null) return 'none';
  if (score >= 67) return 'good';
  if (score >= 34) return 'caution';
  return 'bad';
}

export function monthSummary(fixture: Fixture, month: Date): MonthSummary {
  const start = isoDate(startOfMonth(month));
  const end = isoDate(endOfMonth(month));
  const days = fixture.days.filter((d) => d.date >= start && d.date <= end);
  const plan = days.flatMap((d) => d.plan);
  const nonRest = plan.filter((p) => p.sport !== 'rest');
  const plannedSessions = nonRest.length;
  const completedSessions = nonRest.filter((p) => p.completed).length;
  const evidenceSessions = nonRest.filter(
    (p) => p.completed && Boolean(p.actual_activity_id || p.actual_lifting_session_id),
  ).length;
  const targetSessions = nonRest.filter((p) => p.planned_tss != null).length;
  const plannedTss = nonRest.reduce((sum, p) => sum + (p.planned_tss ?? 0), 0);
  const actualTss =
    days.reduce((sum, d) => sum + d.activities.reduce((s, a) => s + (a.tss ?? 0), 0), 0) +
    days.reduce((sum, d) => sum + d.lifts.reduce((s, l) => s + (l.estimated_tss ?? 0), 0), 0);
  const activityCount = days.reduce((sum, d) => sum + d.activities.length, 0);
  const liftCount = days.reduce((sum, d) => sum + d.lifts.length, 0);
  const restDays = plan.filter((p) => p.sport === 'rest').length;
  const stateOf = (p: PlanDay) => {
    const day = getDay(fixture, p.date);
    return day ? planState(p, day, fixture.today, fixture).status : 'planned';
  };
  const missed = nonRest.filter((p) => stateOf(p) === 'missed').length;
  const mismatch = nonRest.filter((p) => stateOf(p) === 'mismatch').length;
  const doneUnlogged = nonRest.filter((p) => stateOf(p) === 'done-unlogged').length;
  const unplannedActuals = days.reduce(
    (sum, d) => sum + unplannedActivities(d).length + unplannedLifts(d).length,
    0,
  );
  return {
    plannedSessions,
    completedSessions,
    evidenceSessions,
    targetSessions,
    plannedTss,
    actualTss,
    activityCount,
    liftCount,
    restDays,
    missed,
    mismatch,
    doneUnlogged,
    unplannedActuals,
    compliance: plannedSessions ? completedSessions / plannedSessions : null,
    targetCoverage: plannedSessions ? targetSessions / plannedSessions : null,
    hasPlan: plannedSessions > 0 || restDays > 0,
  };
}

export function eventForDay(fixture: Fixture, day: Day): EventRow | undefined {
  return fixture.events.find((e) => e.date === day.date);
}

export function goalForDay(fixture: Fixture, day: Day): GoalRow | undefined {
  return fixture.goals.find((g) => g.target_date === day.date);
}

/** Find an activity anywhere in the response (an off-date plan link). */
function findActivity(fixture: Fixture, id: string): Activity | undefined {
  for (const day of fixture.days) {
    const found = day.activities.find((a) => a.id === id);
    if (found) return found;
  }
  return undefined;
}

/** Find a lift anywhere in the response (an off-date plan link). */
function findLift(fixture: Fixture, id: string): Lift | undefined {
  for (const day of fixture.days) {
    const found = day.lifts.find((l) => l.id === id);
    if (found) return found;
  }
  return undefined;
}

export interface DayInsight {
  tone: Tone;
  title: string;
  detail: string;
}

export function insightForDay(day: Day, today: string, fixture?: Fixture): DayInsight {
  const states = planStates(day, today, fixture);
  const nonRest = states.filter((s) => s.status !== 'rest');
  const actuals = day.activities.length + day.lifts.length;
  const mismatch = nonRest.find((s) => s.status === 'mismatch');
  const missed = nonRest.find((s) => s.status === 'missed');
  const partial = nonRest.find((s) => s.status === 'partial');
  const unlogged = nonRest.find((s) => s.status === 'done-unlogged');
  const planned = nonRest.find((s) => s.status === 'planned');
  const emptyLift = day.lifts.find((l) => l.set_count === 0);

  if (emptyLift) {
    return {
      tone: 'caution',
      title: 'A session exists with no sets',
      detail: `${emptyLift.focus ?? 'Lifting'} is logged at ${emptyLift.duration_seconds ? Math.round(emptyLift.duration_seconds / 60) + ' min' : 'no duration'} but has 0 sets and 0 kg. It needs finishing or removing.`,
    };
  }
  if (mismatch) {
    const planFocus = day.plan.find((p) => p.sport !== 'rest')?.planned_focus;
    if (mismatch.offDate && mismatch.linkedDate) {
      return {
        tone: 'caution',
        title: 'The linked session is on another date',
        detail: `The plan day points to a session logged on ${new Date(`${mismatch.linkedDate}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}, not this day. Confirm the link in Training.`,
      };
    }
    return {
      tone: 'caution',
      title: `Logged${mismatch.lift?.focus ? ` ${mismatch.lift.focus}` : mismatch.activity?.sport_type ? ` ${mismatch.activity.sport_type}` : ''}${planFocus ? `, plan asked for ${planFocus}` : ''}`,
      detail:
        'The session is linked to this day but the plan day is not marked complete. Confirm or correct it in Training.',
    };
  }
  if (missed) {
    const plan = day.plan.find((p) => p.sport !== 'rest');
    return {
      tone: 'bad',
      title: 'No session logged',
      detail: `The plan asked for ${plan?.planned_type ?? 'a session'}${plan?.planned_focus ? ` · ${plan.planned_focus}` : ''}. It is still uncompleted.`,
    };
  }
  if (partial) {
    const pct = partial.ratio != null ? Math.round(partial.ratio * 100) : null;
    const delta = partial.plannedTss != null ? Math.round(partial.actualTss - partial.plannedTss) : null;
    return {
      tone: 'caution',
      title:
        delta != null && delta < 0
          ? `Under target by ${Math.abs(delta)} TSS`
          : delta != null
            ? `Over target by ${delta} TSS`
            : 'Off the planned target',
      detail:
        partial.plannedTss != null
          ? `Planned ${Math.round(partial.plannedTss)} TSS, logged ${Math.round(partial.actualTss)} TSS${pct != null ? ` (${pct}%)` : ''}.`
          : 'The logged load and the plan do not line up.',
    };
  }
  if (unlogged) {
    return {
      tone: 'caution',
      title: 'Marked done, nothing linked',
      detail:
        'The plan says this day is complete, but no activity or lifting session is attached. It is a manual tick, not evidence.',
    };
  }
  if (nonRest.length === 0 && actuals > 0) {
    return {
      tone: 'info',
      title: 'Rest day, trained anyway',
      detail: 'There is no session planned, but work is logged. That is allowed — it is simply unplanned.',
    };
  }
  if (planned) {
    return {
      tone: 'info',
      title: 'Upcoming',
      detail: 'Nothing logged yet. The plan is still ahead of you.',
    };
  }
  if (actuals > 0) {
    const extra = unplannedActivities(day).length + unplannedLifts(day).length;
    if (extra > 0) {
      const extraLoad =
        unplannedActivities(day).reduce((sum, a) => sum + (a.tss ?? 0), 0) +
        unplannedLifts(day).reduce((sum, l) => sum + (l.estimated_tss ?? 0), 0);
      return {
        tone: 'info',
        title: 'On plan, plus unplanned work',
        detail: `The planned session is done. ${extra} extra ${extra === 1 ? 'session is' : 'sessions are'} logged${extraLoad > 0 ? ` (+${Math.round(extraLoad)} TSS)` : ''} — useful, but not on the plan.`,
      };
    }
    return {
      tone: 'good',
      title: 'On plan',
      detail: 'The planned session is done and linked. Nothing needs attention.',
    };
  }
  return {
    tone: 'muted',
    title: 'Nothing planned or logged',
    detail: 'A quiet day. No training target and no activity.',
  };
}
