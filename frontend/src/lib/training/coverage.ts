/**
 * Plan coverage and the per-day read — the derivation the training page is built on.
 *
 * The old page reported `completed_days / day_count`, where `day_count` counts
 * *authored* days. A 20-week plan with 7.5 weeks written and every authored day
 * ticked therefore read as "47/49 days · 96%" — a plan that had run dry, reported
 * as nearly finished. Coverage measures the other thing: how much of the plan's
 * claimed span actually has sessions in it.
 *
 * Everything here is pure and takes `today` as an argument, so the arithmetic is
 * testable without mocking a clock.
 */

import type {
  AdaptiveAxis,
  AdaptiveSuggestionsResponse,
  PlanReviewResponse,
  TrainingPlan,
  TrainingPlanDay,
  TrainingWeekDay,
} from '@/lib/api';
import { addDays, diffDays, getTotalWeeks, getWeek1Start, toDateStr } from './week';

// ── Week summaries ───────────────────────────────────────────────────────

export interface WeekSummary {
  weekNumber: number;
  start: string;
  end: string;
  written: boolean;
  sessions: number;
  restDays: number;
  plannedTss: number;
  done: number;
  missed: number;
  isCurrent: boolean;
  isPast: boolean;
}

export interface Coverage {
  totalWeeks: number;
  writtenWeeks: number;
  uncoveredWeeks: number;
  /** Last date with an authored session, or null when the plan is empty. */
  lastSessionDate: string | null;
  /** First week with no authored days, or null when the plan is complete. */
  firstUnwrittenWeek: number | null;
  /** Whole days between the last session and `today` (null if none). */
  daysSinceLastSession: number | null;
  /** Whole days the plan claims after its last authored session. */
  daysUncovered: number;
  sessions: number;
  restDays: number;
  weeks: WeekSummary[];
}

const isSession = (d: TrainingPlanDay): boolean => d.sport !== 'rest';

/** The 7 calendar dates of a week, whether or not the plan wrote any of them. */
export function weekDates(startDate: string, weekNumber: number): string[] {
  const ws = addDays(getWeek1Start(startDate), (weekNumber - 1) * 7);
  return Array.from({ length: 7 }, (_, i) => addDays(ws, i));
}

export function weekStartDate(startDate: string, weekNumber: number): string {
  return addDays(getWeek1Start(startDate), (weekNumber - 1) * 7);
}

export function weekNumberForDate(startDate: string, endDate: string, date: string): number {
  const total = getTotalWeeks(startDate, endDate);
  const raw = Math.floor(diffDays(getWeek1Start(startDate), date) / 7) + 1;
  return Math.min(total, Math.max(1, raw));
}

export function planCoverage(plan: TrainingPlan, today: string): Coverage {
  const totalWeeks = getTotalWeeks(plan.start_date, plan.end_date);
  const days = plan.days ?? [];

  const byDate = new Map<string, TrainingPlanDay>();
  for (const d of days) byDate.set(d.day_date.slice(0, 10), d);

  const weeks: WeekSummary[] = [];
  for (let n = 1; n <= totalWeeks; n += 1) {
    const start = weekStartDate(plan.start_date, n);
    const end = addDays(start, 6);
    const weekDays = days.filter((d) => {
      const date = d.day_date.slice(0, 10);
      return date >= start && date <= end;
    });
    const sessions = weekDays.filter(isSession).length;
    weeks.push({
      weekNumber: n,
      start,
      end,
      written: weekDays.length > 0,
      sessions,
      restDays: weekDays.length - sessions,
      plannedTss: weekDays.reduce((sum, d) => sum + (d.planned_tss ?? 0), 0),
      done: weekDays.filter((d) => d.completed).length,
      missed: weekDays.filter((d) => !d.completed && d.day_date.slice(0, 10) < today).length,
      isCurrent: today >= start && today <= end,
      isPast: end < today,
    });
  }

  const written = weeks.filter((w) => w.written);
  const authoredDates = days.map((d) => d.day_date.slice(0, 10)).sort();
  const lastSessionDate = authoredDates.length
    ? authoredDates[authoredDates.length - 1]
    : null;
  const firstUnwritten = weeks.find((w) => !w.written) ?? null;

  return {
    totalWeeks,
    writtenWeeks: written.length,
    uncoveredWeeks: totalWeeks - written.length,
    lastSessionDate,
    firstUnwrittenWeek: firstUnwritten?.weekNumber ?? null,
    daysSinceLastSession: lastSessionDate ? diffDays(lastSessionDate, today) : null,
    daysUncovered: lastSessionDate ? Math.max(0, diffDays(lastSessionDate, plan.end_date)) : 0,
    sessions: days.filter(isSession).length,
    restDays: days.filter((d) => !isSession(d)).length,
    weeks,
  };
}

/** True when the plan has no session anywhere after `date`. */
export function planStopsBefore(plan: TrainingPlan, date: string): boolean {
  const dates = (plan.days ?? []).map((d) => d.day_date.slice(0, 10));
  if (dates.length === 0) return true;
  return dates.reduce((a, b) => (a > b ? a : b)) < date;
}

/** Contiguous runs of weeks with no authored days, e.g. `[{9,10},{12,20}]`. */
export function unwrittenRuns(coverage: Coverage): { start: number; end: number }[] {
  const runs: { start: number; end: number }[] = [];
  let start: number | null = null;
  for (const w of coverage.weeks) {
    if (!w.written && start == null) start = w.weekNumber;
    if (w.written && start != null) {
      runs.push({ start, end: w.weekNumber - 1 });
      start = null;
    }
  }
  if (start != null) runs.push({ start, end: coverage.totalWeeks });
  return runs;
}

/**
 * "week 9", "weeks 9–10", "weeks 9–10 and 12–20".
 *
 * The old copy said "Weeks 9–20 are empty", which is false the moment a later week
 * is written. Real plans have holes, not tails: the owner's went 1–8 written, 9–10
 * empty, 11 written.
 */
export function formatWeekRuns(runs: { start: number; end: number }[]): string {
  if (runs.length === 0) return '';
  const label = (r: { start: number; end: number }) =>
    r.start === r.end ? `${r.start}` : `${r.start}–${r.end}`;
  const noun = runs.length === 1 && runs[0].start === runs[0].end ? 'week' : 'weeks';
  const parts = runs.map(label);
  const joined =
    parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return `${noun} ${joined}`;
}

/**
 * The week the written plan reaches — what the boundary marker means.
 *
 * NOT `writtenWeeks / totalWeeks`: that places the marker after the ninth *written*
 * week, so a plan written 1–8 plus 11 drew its boundary at week 9, before content
 * that exists.
 */
export function lastWrittenWeek(coverage: Coverage, plan: TrainingPlan): number | null {
  if (!coverage.lastSessionDate) return null;
  return weekNumberForDate(plan.start_date, plan.end_date, coverage.lastSessionDate);
}

// ── Per-day read: one title, one number, one status ──────────────────────

export type RowStatus = 'done' | 'missed' | 'partial' | 'rest' | 'today' | 'planned' | 'gap';

export interface DayRead {
  date: string;
  status: RowStatus;
  /** What actually happened, when something did. */
  actualLift?: { focus?: string | null; volumeKg?: number | null };
  actualRide?: { distanceM?: number | null; tss?: number | null; name: string };
  /** The plan's description, when it has one. */
  planned?: string;
  sport: string;
  /** The single headline number for the row — actual beats plan. */
  headline: { value: string; unit: string } | null;
  /** One secondary fact, or null. */
  aside: string | null;
  /** The row's title: actual, else description, else a sport label. */
  title: string;
}

const SPORT_LABEL: Record<string, string> = {
  strength: 'Strength',
  cycle: 'Ride',
  rest: 'Rest',
  none: 'No session',
};

/** "7.4" tonnes from kg; "51" km from m. One decimal only below 10. */
const tonnes = (kg?: number | null): string | null =>
  kg == null ? null : (kg / 1000).toFixed(kg >= 10_000 ? 0 : 1);
const km = (m?: number | null): string | null =>
  m == null ? null : (m / 1000).toFixed(m >= 10_000 ? 0 : 1);

const statusOf = (day: TrainingWeekDay, isToday: boolean): RowStatus => {
  switch (day.day_status) {
    case 'rest':
      return 'rest';
    case 'completed':
      return 'done';
    case 'missed':
      return 'missed';
    case 'partial':
      return 'partial';
    default:
      return isToday ? 'today' : 'planned';
  }
};

export function readDay(
  date: string,
  day: TrainingWeekDay | undefined,
  today: string,
): DayRead {
  const isToday = date === today;

  if (!day) {
    return {
      date,
      status: isToday ? 'today' : 'gap',
      sport: 'none',
      headline: null,
      aside: null,
      title: 'No session',
    };
  }

  const lift = day.actual_lifting_session ?? undefined;
  const ride = day.actual_activity ?? undefined;
  const status = statusOf(day, isToday);

  const liftTonnes = tonnes(lift?.total_volume_kg);
  const rideKm = km(ride?.distance_meters);

  // A missed session has no number: the absence is the point. Showing the
  // planned duration beside "Missed" reads as load that was banked. The same is
  // true of a rest day — "0 TSS" is not a measurement.
  const headline =
    status === 'missed' || status === 'rest'
      ? null
      : liftTonnes != null
        ? { value: liftTonnes, unit: 't' }
        : rideKm != null
          ? { value: rideKm, unit: 'km' }
          : day.planned_tss != null
            ? { value: String(Math.round(day.planned_tss)), unit: 'TSS' }
            : day.planned_duration_min != null
              ? { value: String(day.planned_duration_min), unit: 'min' }
              : null;

  const aside =
    status !== 'rest' && lift?.focus
      ? lift.focus
      : ride?.tss != null
        ? `${Math.round(ride.tss)} TSS`
        : (day.planned_focus ?? day.planned_zone?.toUpperCase() ?? null);

  const title = lift
    ? `${lift.focus ?? 'Lift'} session`
    : ride
      ? ride.name
      : (day.workout_description ?? SPORT_LABEL[day.sport] ?? 'Session');

  return {
    date,
    status,
    actualLift: lift ? { focus: lift.focus, volumeKg: lift.total_volume_kg } : undefined,
    actualRide: ride
      ? { distanceM: ride.distance_meters, tss: ride.tss, name: ride.name }
      : undefined,
    planned: day.workout_description ?? undefined,
    sport: day.sport,
    headline,
    aside,
    title,
  };
}

/** The plan when an actual exists and the plan said something; otherwise null. */
export function plannedAside(r: DayRead): string | null {
  if (!(r.actualLift || r.actualRide)) return null;
  return r.planned ? `planned: ${r.planned}` : null;
}

// ── Verdict: reconcile the snapshot with the live engine ─────────────────

export interface PlanVerdict {
  headline: string;
  reason: string;
  /** Who said it, and when — shown under the reason. */
  source: string;
  tone: 'ok' | 'caution';
  action: { label: string; href: string } | null;
  /** Set when the persisted snapshot and the live engine disagree on load. */
  conflict: { snapshot: string; live: string; snapshotDate: string; liveDate: string } | null;
}

const shortDate = (iso: string): string => {
  const d = new Date(iso.slice(0, 10) + 'T00:00:00');
  return `${d.getDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]}`;
};

/**
 * Two engines answer different questions and the old page printed both summaries,
 * so it said "health is flagging, resolve before adding load" and "signals are
 * balanced — stick to the plan" on the same screen.
 *
 * Here: a pending health axis is a *prerequisite* and becomes the action; the load
 * verdict comes from the fresher engine and carries its date; a disagreement is
 * named once, in a footnote, instead of being reprinted as a second headline.
 */
export function planVerdict(
  live: AdaptiveSuggestionsResponse | undefined,
  snapshot: PlanReviewResponse | undefined,
): PlanVerdict {
  const liveAxes: AdaptiveAxis[] = live?.axes ?? [];
  const snapAxes = snapshot?.adaptive?.axes ?? [];

  const health =
    liveAxes.find((a) => a.key === 'health') ??
    (snapAxes.find((a) => a.key === 'health') as { key: string; title: string; stance: string; severity: string; guidance?: string } | undefined);

  const loadAxis = liveAxes.find((a) => a.key === 'load');
  const liveFatigue = live?.fatigue ?? null;
  const snapFatigue = snapshot?.adaptive?.fatigue ?? null;

  const conflict =
    liveFatigue && snapFatigue && liveFatigue !== snapFatigue
      ? {
          snapshot: snapFatigue,
          live: liveFatigue,
          snapshotDate: shortDate(snapshot?.generated_at ?? ''),
          liveDate: shortDate(live?.generated_at ?? ''),
        }
      : null;

  const healthPending = health != null && health.severity !== 'info';

  if (healthPending && health) {
    return {
      headline: health.title ? `Clear ${health.title.toLowerCase()} before adding load` : 'Resolve health signals before adding load',
      reason:
        health.guidance ??
        'Health is a prerequisite, not a training signal — the load engine cannot judge a week it cannot see the recovery for.',
      source: `health · ${shortDate(snapshot?.generated_at ?? live?.generated_at ?? '')}`,
      tone: 'caution',
      action: { label: 'Open Health', href: '/health' },
      conflict,
    };
  }

  const guidance = loadAxis?.guidance ?? live?.summary ?? null;

  return {
    headline: 'Nothing to change — the load is in the healthy band',
    reason: guidance ?? 'No load signal this week.',
    source: `load · ${shortDate(live?.generated_at ?? '')}`,
    tone: liveFatigue && liveFatigue !== 'balanced' ? 'caution' : 'ok',
    action: null,
    conflict,
  };
}

/** True when the plan has any strength day — the correct key for S1–S4 aids. */
export function planHasStrengthDays(plan: TrainingPlan | undefined): boolean {
  if (!plan) return false;
  return (plan.days ?? []).some((d) => d.sport === 'strength');
}

export const todayStr = (): string => toDateStr(new Date());
