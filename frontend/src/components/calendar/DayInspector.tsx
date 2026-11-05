'use client';

import React from 'react';
import Link from 'next/link';
import {
  ArrowUpRight,
  CalendarDays,
  Check,
  Clock,
  Flag,
  Gauge,
  HeartPulse,
  Moon,
  Mountain,
  Target,
  TriangleAlert,
  X,
  Zap,
} from 'lucide-react';
import type {
  CalendarActivity as Activity,
  CalendarDay as Day,
  CalendarResponse as Fixture,
  CalendarLift as Lift,
  CalendarPlanDay as PlanDay,
} from '@/lib/api';
import {
  dayLabel,
  dayStatus,
  eventForDay,
  goalForDay,
  insightForDay,
  loggedCount,
  parseDate,
  planState,
  unplannedActivities,
  unplannedLifts,
} from '@/lib/calendar';
import {
  fmtDistance,
  fmtDuration,
  fmtSleepSeconds,
  fmtTime,
  fmtVolume,
  focusLabel,
  sportLabel,
  titleCase,
} from '@/lib/calendarFormat';
import { Card, Pill, RecoveryDot, SectionLabel, SportGlyph, StatusPill, cx, toneText } from './calendarUi';

const TONE_BORDER: Record<string, string> = {
  good: 'border-positive/25 bg-positive/[0.06]',
  caution: 'border-caution/30 bg-caution/[0.06]',
  bad: 'border-warning/30 bg-warning/[0.06]',
  info: 'border-info/25 bg-info/[0.06]',
  muted: 'border-surface-light/60 bg-surface-light/30',
};

function Stat({
  label,
  value,
  unit,
  icon,
}: {
  label: string;
  value: string;
  unit?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-surface-light/60 bg-surface/50 px-2.5 py-2">
      <p className="flex items-center gap-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-muted/55">
        {icon}
        {label}
      </p>
      <p className="mt-1 text-sm font-semibold leading-none text-foreground">
        {value}
        {unit && <span className="ml-1 text-[10px] font-medium text-muted/60">{unit}</span>}
      </p>
    </div>
  );
}

function PlanRow({
  plan,
  day,
  today,
  fixture,
}: {
  plan: PlanDay;
  day: Day;
  today: string;
  fixture: Fixture;
}) {
  const state = planState(plan, day, today, fixture);
  const isRest = plan.sport === 'rest';
  const title = isRest
    ? 'Rest day'
    : plan.sport === 'strength'
      ? `${focusLabel(plan.planned_focus)}${plan.planned_type ? ` · ${titleCase(plan.planned_type)}` : ''}`
      : `${titleCase(plan.planned_type)} ride`;
  const details = [
    plan.planned_duration_min ? `${plan.planned_duration_min} min` : null,
    plan.planned_tss != null ? `${Math.round(plan.planned_tss)} TSS` : null,
    plan.planned_power_watts != null ? `${Math.round(plan.planned_power_watts)} W` : null,
    plan.planned_zone ? plan.planned_zone.toUpperCase() : null,
    plan.planned_volume_kg != null ? `${fmtVolume(plan.planned_volume_kg)} target` : null,
  ].filter(Boolean);

  return (
    <div className="rounded-xl border border-surface-light/50 bg-surface-light/30 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-surface-light/40">
            <SportGlyph sport={plan.sport} className="h-3.5 w-3.5 text-foreground/75" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-foreground">{title}</p>
            <p className="mt-0.5 text-[10px] text-muted/65">
              {details.length ? details.join(' · ') : 'No target set'}
            </p>
          </div>
        </div>
        <StatusPill status={state.status} />
      </div>

      {plan.workout_description && (
        <p className="mt-2 text-[11px] leading-4 text-muted/75">{plan.workout_description}</p>
      )}

      {state.status === 'partial' && state.ratio != null && (
        <p className="mt-2 text-[10px] leading-4 text-caution">
          {Math.round(state.ratio * 100)}% of planned load
          {state.plannedTss != null && ` · ${Math.round(state.actualTss)} of ${Math.round(state.plannedTss)} TSS`}
        </p>
      )}
      {state.status === 'done-unlogged' && (
        <p className="mt-2 text-[10px] leading-4 text-caution">
          Marked done, but no activity or lift is linked.
        </p>
      )}
      {state.status === 'missed' && (
        <p className="mt-2 text-[10px] leading-4 text-warning">
          Past — not logged and not marked complete.
        </p>
      )}
      {state.status === 'mismatch' && state.offDate && state.linkedDate && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="text-[10px] leading-4 text-caution">
            Linked session is on {parseDate(state.linkedDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} — the dates do not match.
          </p>
          {(state.lift || state.activity) && (
            <Link
              href={
                state.lift
                  ? `/lifting?session=${state.lift.id}`
                  : `/activities?activity=${state.activity!.id}`
              }
              className="inline-flex items-center gap-1 text-[10px] font-semibold text-accent/80 hover:text-accent"
            >
              Open linked session <ArrowUpRight className="h-3 w-3" />
            </Link>
          )}
        </div>
      )}
      {state.status === 'mismatch' && !state.offDate && (
        <p className="mt-2 text-[10px] leading-4 text-caution">
          Logged work is linked, but the plan day is not confirmed.
        </p>
      )}
    </div>
  );
}

function ExerciseSets({ lift }: { lift: Lift }) {
  const byExercise = new Map<string, Lift['sets']>();
  for (const set of lift.sets) {
    const list = byExercise.get(set.exercise_name) ?? [];
    list.push(set);
    byExercise.set(set.exercise_name, list);
  }
  const entries = [...byExercise.entries()].slice(0, 3);
  if (entries.length === 0) return null;
  return (
    <div className="mt-2 space-y-1">
      {entries.map(([exercise, sets]) => (
        <div key={exercise} className="flex items-baseline justify-between gap-2 text-[10px]">
          <span className="truncate text-muted/75">{exercise}</span>
          <span className="shrink-0 text-foreground/75">
            {sets
              .sort((a, b) => a.set_number - b.set_number)
              .map((s) => `${s.weight_kg}×${s.reps}${s.is_warmup ? 'w' : ''}`)
              .join(' · ')}
          </span>
        </div>
      ))}
      {byExercise.size > 3 && (
        <p className="text-[10px] text-muted/50">+{byExercise.size - 3} more exercises</p>
      )}
    </div>
  );
}

function ActivityRow({ activity, unplanned }: { activity: Activity; unplanned: boolean }) {
  const ctx = activity.ride_context;
  return (
    <div className="rounded-xl border border-surface-light/50 bg-surface-light/30 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-surface-light/40">
            <SportGlyph sport={activity.sport_type} className="h-3.5 w-3.5 text-foreground/75" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-foreground">
              {activity.name || sportLabel(activity.sport_type)}
            </p>
            <p className="mt-0.5 text-[10px] text-muted/65">
              {sportLabel(activity.sport_type)}
              {activity.start_date && ` · ${fmtTime(activity.start_date)}`}
              {activity.distance_meters ? ` · ${fmtDistance(activity.distance_meters)}` : ''}
            </p>
          </div>
        </div>
        {unplanned ? (
          <Pill tone="info">Unplanned</Pill>
        ) : (
          <Pill tone="good">
            <Check className="h-2.5 w-2.5" /> Logged
          </Pill>
        )}
      </div>

      <div className="mt-2 grid grid-cols-3 gap-1.5">
        <Stat label="Time" value={fmtDuration(activity.duration_seconds)} />
        <Stat label="Load" value={activity.tss != null ? String(Math.round(activity.tss)) : '—'} unit={activity.tss != null ? 'TSS' : undefined} />
        <Stat
          label={activity.normalized_power ? 'NP' : 'HR'}
          value={
            activity.normalized_power
              ? `${Math.round(activity.normalized_power)}`
              : activity.average_heartrate
                ? `${Math.round(activity.average_heartrate)}`
                : '—'
          }
          unit={activity.normalized_power ? 'W' : activity.average_heartrate ? 'bpm' : undefined}
        />
      </div>

      {(activity.elevation_gain_meters || ctx?.intensity_factor || ctx?.decoupling_pct) && (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted/65">
          {activity.elevation_gain_meters != null && activity.elevation_gain_meters > 0 && (
            <span className="inline-flex items-center gap-1">
              <Mountain className="h-3 w-3" /> {Math.round(activity.elevation_gain_meters)} m
            </span>
          )}
          {ctx?.intensity_factor != null && (
            <span className="inline-flex items-center gap-1">
              <Gauge className="h-3 w-3" /> IF {ctx.intensity_factor.toFixed(2)}
            </span>
          )}
          {ctx?.decoupling_pct != null && (
            <span className="inline-flex items-center gap-1">
              <HeartPulse className="h-3 w-3" /> {ctx.decoupling_pct.toFixed(1)}% decoup.
            </span>
          )}
          {ctx?.climbing_meters != null && ctx.climbing_meters > 0 && (
            <span className="inline-flex items-center gap-1">
              <Mountain className="h-3 w-3" /> {Math.round(ctx.climbing_meters)} m climbing
            </span>
          )}
        </div>
      )}

      <Link
        href={`/activities?activity=${activity.id}`}
        className="mt-2 inline-flex items-center gap-1 text-[10px] font-semibold text-accent/85 hover:text-accent"
      >
        View activity <ArrowUpRight className="h-3 w-3" />
      </Link>
    </div>
  );
}

function LiftRow({ lift, unplanned }: { lift: Lift; unplanned: boolean }) {
  return (
    <div className="rounded-xl border border-surface-light/50 bg-surface-light/30 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-surface-light/40">
            <SportGlyph sport="strength" className="h-3.5 w-3.5 text-foreground/75" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-foreground">
              {lift.focus ? focusLabel(lift.focus) : lift.program_name || 'Lifting session'}
            </p>
            <p className="mt-0.5 text-[10px] text-muted/65">
              {lift.set_count} sets · {fmtVolume(lift.total_volume_kg)} volume
              {lift.estimated_tss != null ? ` · ${Math.round(lift.estimated_tss)} TSS` : ''}
            </p>
          </div>
        </div>
        {unplanned ? (
          <Pill tone="info">Unplanned</Pill>
        ) : (
          <Pill tone="good">
            <Check className="h-2.5 w-2.5" /> Logged
          </Pill>
        )}
      </div>

      <div className="mt-2 grid grid-cols-3 gap-1.5">
        <Stat label="Sets" value={String(lift.set_count)} />
        <Stat label="Volume" value={fmtVolume(lift.total_volume_kg)} />
        <Stat
          label="Load"
          value={lift.estimated_tss != null ? String(Math.round(lift.estimated_tss)) : '—'}
          unit={lift.estimated_tss != null ? 'TSS' : undefined}
        />
      </div>

      {lift.set_count === 0 && (
        <p className="mt-2 flex items-start gap-1 text-[10px] leading-4 text-caution">
          <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" />
          This session has no sets yet.
        </p>
      )}

      <ExerciseSets lift={lift} />

      <Link
        href={`/lifting?session=${lift.id}`}
        className="mt-2 inline-flex items-center gap-1 text-[10px] font-semibold text-accent/85 hover:text-accent"
      >
        Open session <ArrowUpRight className="h-3 w-3" />
      </Link>
    </div>
  );
}

export function DayInspector({
  fixture,
  day,
  today,
  variant = 'panel',
  surface = 'card',
  onClose,
}: {
  fixture: Fixture;
  day: Day | undefined;
  today: string;
  variant?: 'panel' | 'sheet';
  /** `bare` is for the app Modal, which supplies the surface and scroll. */
  surface?: 'card' | 'bare';
  onClose?: () => void;
}) {
  if (!day) {
    return (
      <Card className={cx('!p-0 flex flex-col', variant === 'panel' ? 'h-full min-h-[420px]' : 'min-h-[280px]')}>
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
          <CalendarDays className="h-6 w-6 text-muted/50" />
          <p className="text-sm font-semibold text-foreground/80">Pick a day</p>
          <p className="max-w-[220px] text-[11px] leading-4 text-muted/60">
            Planned sessions, logged work and health sit together here.
          </p>
        </div>
      </Card>
    );
  }

  const date = parseDate(day.date);
  const status = dayStatus(day, today, fixture);
  const insight = insightForDay(day, today, fixture);
  const unplannedActRows = unplannedActivities(day);
  const unplannedLiftRows = unplannedLifts(day);
  const event = eventForDay(fixture, day);
  const goal = goalForDay(fixture, day);
  const isToday = day.date === today;
  const metric = day.metric;
  const sleep = day.sleep;
  const sleepMinutes = sleep?.total_sleep_seconds
    ? sleep.total_sleep_seconds / 60
    : metric?.sleep_duration_minutes ?? null;
  const hasHealth =
    metric?.recovery_score != null ||
    metric?.hrv_ms != null ||
    metric?.resting_hr != null ||
    metric?.strain != null ||
    sleepMinutes != null;
  const hasPlan = day.plan.length > 0;
  // A strength activity + lifting session on one date is one session; the lift
  // carries the sets, so render the lift and drop the paired activity.
  const visibleActivities = day.activities.filter(
    (activity) => !(activity.sport_type === 'strength' && day.lifts.length > 0),
  );
  const logged = loggedCount(day);
  const hasActual = logged > 0;
  const planDay = day.plan.find((p) => p.sport !== 'rest') ?? day.plan[0];
  const trainingHref =
    planDay && fixture.plan
      ? `/training?plan=${fixture.plan.id}&day=${day.date}`
      : '/training';
  const shouldStartLift =
    isToday && planDay?.sport === 'strength' && !planDay.completed;

  const content = (
    <>
      <div className="flex items-start justify-between gap-2 border-b border-surface-light/60 px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="text-sm font-semibold text-foreground">{dayLabel(date)}</p>
            {isToday && <Pill tone="info">Today</Pill>}
            <StatusPill status={status} />
          </div>
          <p className="mt-1 text-[10px] text-muted/55">
            {hasPlan ? 'Plan entry exists' : 'No plan entry'} ·{' '}
            {hasActual ? `${logged} logged` : 'nothing logged'}
          </p>
        </div>
        {variant === 'sheet' && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close day detail"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-surface-light/70 text-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <div className={cx('rounded-xl border px-3 py-2.5', TONE_BORDER[insight.tone])}>
          <p className={cx('text-[11px] font-semibold leading-4', toneText(insight.tone))}>
            {insight.title}
          </p>
          <p className="mt-0.5 text-[10px] leading-4 text-muted/70">{insight.detail}</p>
        </div>

        {(event || goal) && (
          <div className="mt-3 space-y-1.5">
            {event && (
              <div className="flex items-start gap-2 rounded-xl border border-caution/20 bg-caution/[0.05] px-3 py-2">
                <Flag className="mt-0.5 h-3.5 w-3.5 shrink-0 text-caution" />
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold text-foreground/85">
                    {event.name}
                  </p>
                  <p className="text-[10px] text-muted/60">
                    {titleCase(event.event_type)}
                    {event.target_tss != null ? ` · ${Math.round(event.target_tss)} TSS target` : ''}
                  </p>
                </div>
              </div>
            )}
            {goal && (
              <div className="flex items-start gap-2 rounded-xl border border-info/20 bg-info/[0.05] px-3 py-2">
                <Target className="mt-0.5 h-3.5 w-3.5 shrink-0 text-info" />
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold text-foreground/85">
                    Goal target date
                  </p>
                  <p className="text-[10px] text-muted/60">
                    {titleCase(goal.metric.replace(/_/g, ' '))} {goal.target_value}
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="mt-4">
          <SectionLabel>Planned</SectionLabel>
          <div className="mt-1.5 space-y-1.5">
            {hasPlan ? (
              day.plan.map((plan) => (
                <PlanRow key={plan.id} plan={plan} day={day} today={today} fixture={fixture} />
              ))
            ) : (
              <p className="rounded-xl border border-dashed border-surface-light/50 px-3 py-2 text-[10px] text-muted/60">
                No plan entry — this day is yours.
              </p>
            )}
          </div>
        </div>

        <div className="mt-4">
          <SectionLabel>Actual</SectionLabel>
          <div className="mt-1.5 space-y-1.5">
            {visibleActivities.map((activity) => (
              <ActivityRow
                key={activity.id}
                activity={activity}
                unplanned={unplannedActRows.some((a) => a.id === activity.id)}
              />
            ))}
            {day.lifts.map((lift) => (
              <LiftRow
                key={lift.id}
                lift={lift}
                unplanned={unplannedLiftRows.some((l) => l.id === lift.id)}
              />
            ))}
            {!hasActual && (
              <p className="rounded-xl border border-dashed border-surface-light/50 px-3 py-2 text-[10px] text-muted/60">
                {day.date < today ? 'Nothing logged for this day.' : 'Not logged yet.'}
              </p>
            )}
          </div>
        </div>

        <div className="mt-4">
          <SectionLabel>Health</SectionLabel>
          {hasHealth ? (
            <div className="mt-1.5 grid grid-cols-3 gap-1.5">
              <Stat
                label="Recovery"
                value={metric?.recovery_score != null ? `${Math.round(metric.recovery_score)}` : '—'}
                unit={metric?.recovery_score != null ? '%' : undefined}
                icon={<RecoveryDot score={metric?.recovery_score} />}
              />
              <Stat label="HRV" value={metric?.hrv_ms != null ? `${Math.round(metric.hrv_ms)}` : '—'} unit={metric?.hrv_ms != null ? 'ms' : undefined} />
              <Stat label="RHR" value={metric?.resting_hr != null ? `${Math.round(metric.resting_hr)}` : '—'} unit={metric?.resting_hr != null ? 'bpm' : undefined} />
              <Stat label="Sleep" value={fmtSleepSeconds(sleep?.total_sleep_seconds ?? (sleepMinutes != null ? sleepMinutes * 60 : null))} />
              <Stat
                label="Efficiency"
                value={sleep?.sleep_efficiency != null ? `${Math.round(sleep.sleep_efficiency)}` : metric?.sleep_efficiency != null ? `${Math.round(metric.sleep_efficiency)}` : '—'}
                unit={sleep?.sleep_efficiency != null || metric?.sleep_efficiency != null ? '%' : undefined}
              />
              <Stat label="Strain" value={metric?.strain != null ? metric.strain.toFixed(1) : '—'} unit={metric?.strain != null ? '/21' : undefined} />
            </div>
          ) : (
            <p className="mt-1.5 rounded-xl border border-dashed border-surface-light/50 px-3 py-2 text-[10px] text-muted/60">
              No recovery or sleep data for this day.
            </p>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-surface-light/60 pt-3">
          <Link
            href={trainingHref}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-accent/25 bg-accent/10 px-3 text-[11px] font-semibold text-accent transition-colors hover:bg-accent/15"
          >
            Open in Training <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
          {shouldStartLift && (
            <Link
              href="/lifting/live"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-surface-light/70 bg-surface-light/40 px-3 text-[11px] font-semibold text-foreground/85 transition-colors hover:border-accent/30"
            >
              <Zap className="h-3.5 w-3.5" /> Start Live Lift
            </Link>
          )}
          {hasPlan && planDay && (
            <span className="inline-flex items-center gap-1 text-[10px] text-muted/45">
              <Clock className="h-3 w-3" /> {fmtDuration((planDay.planned_duration_min ?? 0) * 60)}
            </span>
          )}
        </div>

        {!hasPlan && !hasActual && (
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-surface-light/60 bg-surface-light/20 px-3 py-2 text-[10px] text-muted/60">
            <Moon className="h-3.5 w-3.5" />
            A quiet day. Nothing planned and nothing logged.
          </div>
        )}
      </div>
    </>
  );

  if (surface === 'bare') {
    return <div className="flex flex-col">{content}</div>;
  }

  return (
    <Card
      className={cx(
        '!p-0 flex min-h-0 flex-col overflow-hidden !border-surface-light/50',
        variant === 'panel' ? 'h-full' : 'max-h-[86vh]',
      )}
    >
      {content}
    </Card>
  );
}
