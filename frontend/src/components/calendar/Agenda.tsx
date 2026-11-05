'use client';

import React from 'react';
import { Minus, Moon } from 'lucide-react';
import type {
  CalendarDay as Day,
  CalendarPlanDay as PlanDay,
  CalendarResponse as Fixture,
} from '@/lib/api';
import {
  dayStatus,
  isoDate,
  isoWeek,
  loggedCount,
  monthWeeks,
  parseDate,
  planState,
  statusLabel,
  weekLabel,
} from '@/lib/calendar';
import { fmtDistance, fmtDuration, fmtVolume, focusLabel } from '@/lib/calendarFormat';
import { RecoveryDot, SportGlyph, StatusPill, cx } from './calendarUi';

function MiniPlan({
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
  const label =
    plan.sport === 'rest'
      ? 'Rest'
      : plan.sport === 'strength'
        ? `${focusLabel(plan.planned_focus)}${plan.planned_duration_min ? ` · ${plan.planned_duration_min}m` : ''}`
        : plan.planned_tss != null
          ? `${Math.round(plan.planned_tss)} TSS`
          : `${plan.planned_type}${plan.planned_duration_min ? ` ${plan.planned_duration_min}m` : ''}`;
  return (
    <span
      className={cx(
        'inline-flex max-w-full items-center gap-1 rounded-md border border-dashed px-1.5 py-0.5 text-[10px] leading-4',
        plan.sport === 'rest'
          ? 'border-surface-light/60 text-muted'
          : 'border-surface-light text-foreground/70',
        state.status === 'missed' && 'calendar-missed-hatch border-warning/40 text-warning',
        state.status === 'mismatch' && 'border-caution/50 text-caution',
      )}
    >
      <SportGlyph sport={plan.sport} className="text-muted" />
      <span className="truncate">{label}</span>
    </span>
  );
}

function MiniActual({ day }: { day: Day }) {
  const unplannedActs = day.activities.filter(
    (a) =>
      !day.plan.some((p) => p.actual_activity_id === a.id) &&
      !(a.sport_type === 'strength' && day.lifts.length > 0),
  );
  const unplannedLiftIds = new Set(
    day.plan.map((p) => p.actual_lifting_session_id).filter(Boolean) as string[],
  );
  const chips = [
    ...day.lifts.map((lift) => ({
      key: `l-${lift.id}`,
      sport: 'strength',
      label: `${lift.focus ? focusLabel(lift.focus) : 'Lift'} · ${
        lift.total_volume_kg ? fmtVolume(lift.total_volume_kg) : `${lift.set_count} sets`
      }`,
      tss: lift.estimated_tss,
      unplanned: !unplannedLiftIds.has(lift.id),
    })),
    ...day.activities
      .filter((a) => !(a.sport_type === 'strength' && day.lifts.length > 0))
      .map((activity) => ({
        key: `a-${activity.id}`,
        sport: activity.sport_type,
        label:
          activity.distance_meters && activity.distance_meters > 0
            ? fmtDistance(activity.distance_meters)
            : fmtDuration(activity.duration_seconds),
        tss: activity.tss,
        unplanned: unplannedActs.some((a) => a.id === activity.id),
      })),
  ].slice(0, 3);

  return (
    <>
      {chips.map((chip) => (
        <span
          key={chip.key}
          className={cx(
            'inline-flex max-w-full items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] leading-4',
            chip.unplanned
              ? 'border-dotted border-info/35 text-info/80'
              : 'border-surface-light/70 bg-surface-light/30 text-foreground/70',
          )}
        >
          <SportGlyph sport={chip.sport} />
          <span className="truncate">{chip.label}</span>
          {chip.tss != null && (
            <span className="ml-auto shrink-0 text-[9px] text-muted">
              {Math.round(chip.tss)}
            </span>
          )}
        </span>
      ))}
    </>
  );
}

function DayNumber({ date, today }: { date: Date; today: string }) {
  return (
    <span className="flex w-9 shrink-0 flex-col items-center pt-0.5">
      <span
        className={cx(
          'text-base font-semibold leading-none',
          isoDate(date) === today ? 'text-accent' : 'text-foreground/85',
        )}
      >
        {date.getDate()}
      </span>
      <span className="mt-1 text-[9px] uppercase tracking-[0.1em] text-muted">
        {date.toLocaleDateString('en-GB', { weekday: 'short' })}
      </span>
    </span>
  );
}

function RestRow({
  date,
  today,
  onOpen,
}: {
  date: Date;
  today: string;
  onOpen: () => void;
}) {
  const label = date.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${label}, rest day`}
      className="flex w-full items-center gap-3 border-t border-surface-light/40 px-3 py-1.5 text-left transition-colors hover:bg-surface-light/25"
    >
      <DayNumber date={date} today={today} />
      <span className="flex flex-1 items-center gap-1.5 text-[10px] text-muted">
        <Moon className="h-3 w-3" /> Rest
      </span>
      <span className="text-[9px] text-muted">no training</span>
    </button>
  );
}

function DayRow({
  fixture,
  date,
  day,
  today,
  selected,
  onOpen,
}: {
  fixture: Fixture;
  date: Date;
  day: Day;
  today: string;
  selected: boolean;
  onOpen: () => void;
}) {
  const status = dayStatus(day, today);
  const label = date.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  const accessible = [
    label,
    day.plan.length ? `${day.plan.length} planned` : null,
    loggedCount(day) ? `${loggedCount(day)} logged` : null,
    statusLabel(status),
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={accessible}
      className={cx(
        'flex w-full items-start gap-3 border-t border-surface-light/40 px-3 py-2.5 text-left transition-colors',
        selected ? 'bg-accent/[0.07]' : 'hover:bg-surface-light/25',
      )}
    >
      <DayNumber date={date} today={today} />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        {day.plan.map((plan) => (
          <MiniPlan key={plan.id} plan={plan} day={day} today={today} fixture={fixture} />
        ))}
        <MiniActual day={day} />
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1 pt-0.5">
        <StatusPill status={status} />
        <span className="flex items-center gap-1">
          <RecoveryDot score={day.metric?.recovery_score} />
          {loggedCount(day) > 0 ? (
            <span className="text-[9px] text-muted">{loggedCount(day)}</span>
          ) : null}
        </span>
      </span>
    </button>
  );
}

function QuietRun({ days }: { days: { date: Date }[] }) {
  const first = days[0].date;
  const last = days[days.length - 1].date;
  return (
    <div className="flex items-center gap-2 border-t border-surface-light/40 px-3 py-1.5 text-[10px] text-muted">
      <Minus className="h-3 w-3" />
      {days.length === 1
        ? `Quiet day · ${first.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
        : `${days.length} quiet days · ${first.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}–${last.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`}
    </div>
  );
}

function WeekHeader({
  weekStart,
  weekEnd,
  planned,
  done,
  plannedTss,
  actualTss,
}: {
  weekStart: Date;
  weekEnd: Date;
  planned: number;
  done: number;
  plannedTss: number;
  actualTss: number;
}) {
  return (
    <div className="flex items-center justify-between gap-2 bg-surface-light/[0.12] px-3 py-2">
      <div className="flex items-baseline gap-2">
        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted">
          W{isoWeek(weekStart)}
        </span>
        <span className="text-[10px] text-muted">{weekLabel(weekStart, weekEnd)}</span>
      </div>
      <div className="flex items-center gap-2 text-[10px] text-muted">
        <span>
          {done}/{planned} done
        </span>
        <span className="text-muted">P {plannedTss ? Math.round(plannedTss) : '—'}</span>
        <span className="text-foreground/70">
          {actualTss ? Math.round(actualTss) : '—'} TSS
        </span>
      </div>
    </div>
  );
}

function rangeLabel(first: Date, last: Date): string {
  if (isoDate(first) === isoDate(last)) {
    return first.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }
  return weekLabel(first, last);
}

function QuietWeeks({ weeks }: { weeks: { first: Date; last: Date }[] }) {
  const first = weeks[0].first;
  const last = weeks[weeks.length - 1].last;
  return (
    <div className="flex items-center gap-2 rounded-2xl border border-surface-light/40 bg-surface px-3 py-3 text-[10px] text-muted">
      <Minus className="h-3 w-3" />
      No sessions planned · {rangeLabel(first, last)}
    </div>
  );
}

export function Agenda({
  fixture,
  month,
  today,
  selectedDate,
  onSelect,
  onOpenDay,
}: {
  fixture: Fixture;
  month: Date;
  today: string;
  selectedDate: string;
  onSelect: (date: string) => void;
  onOpenDay: (date: string) => void;
}) {
  const weeks = monthWeeks(fixture, month);
  const windowStart = parseDate(fixture.range.start);
  const windowEnd = parseDate(fixture.range.end);
  const entries = weeks
    .map((week) => ({
      week,
      days: week.days.filter(
        (d) => d.inMonth && d.date >= windowStart && d.date <= windowEnd,
      ),
    }))
    .filter((entry) => entry.days.length > 0);

  const rendered: React.ReactNode[] = [];
  let quietWeeks: { first: Date; last: Date }[] = [];

  const flushQuietWeeks = () => {
    if (quietWeeks.length === 0) return;
    rendered.push(
      <QuietWeeks key={`qw-${isoDate(quietWeeks[0].first)}`} weeks={quietWeeks} />,
    );
    quietWeeks = [];
  };

  for (const { week, days } of entries) {
    const hasContent = days.some(
      ({ day }) => Boolean(day && (day.plan.length || day.activities.length || day.lifts.length)),
    );
    if (!hasContent) {
      quietWeeks.push({ first: days[0].date, last: days[days.length - 1].date });
      continue;
    }
    flushQuietWeeks();

    const first = days[0].date;
    const last = days[days.length - 1].date;
    const planDays = days.flatMap(({ day }) => day?.plan ?? []).filter((p) => p.sport !== 'rest');
    const planned = planDays.length;
    const done = planDays.filter((p) => p.completed).length;
    const plannedTss = planDays.reduce((sum, p) => sum + (p.planned_tss ?? 0), 0);
    const actualTss = days.reduce((sum, { day }) => {
      if (!day) return sum;
      return (
        sum +
        day.activities.reduce((s, a) => s + (a.tss ?? 0), 0) +
        day.lifts.reduce((s, l) => s + (l.estimated_tss ?? 0), 0)
      );
    }, 0);

    const items: React.ReactNode[] = [];
    let quietDays: { date: Date }[] = [];
    const flushQuietDays = () => {
      if (quietDays.length === 0) return;
      items.push(<QuietRun key={`qd-${isoDate(quietDays[0].date)}`} days={quietDays} />);
      quietDays = [];
    };

    for (const { date, day } of days) {
      const dateKey = isoDate(date);
      const restOnly =
        Boolean(day) &&
        day!.plan.length > 0 &&
        day!.plan.every((p) => p.sport === 'rest') &&
        day!.activities.length === 0 &&
        day!.lifts.length === 0;
      const hasDayContent =
        Boolean(day) && Boolean(day!.plan.length || day!.activities.length || day!.lifts.length);
      if (!hasDayContent && dateKey !== today) {
        quietDays.push({ date });
        continue;
      }
      flushQuietDays();
      if (restOnly) {
        items.push(
          <RestRow
            key={dateKey}
            date={date}
            today={today}
            onOpen={() => {
              onSelect(dateKey);
              onOpenDay(dateKey);
            }}
          />,
        );
      } else if (day) {
        items.push(
          <DayRow
            key={dateKey}
            fixture={fixture}
            date={date}
            day={day}
            today={today}
            selected={dateKey === selectedDate}
            onOpen={() => {
              onSelect(dateKey);
              onOpenDay(dateKey);
            }}
          />,
        );
      } else {
        items.push(
          <QuietRun key={dateKey} days={[{ date }]} />,
        );
      }
    }
    flushQuietDays();

    rendered.push(
      <div
        key={isoDate(week.weekStart)}
        className="overflow-hidden rounded-2xl border border-surface-light/50 bg-surface"
      >
        <WeekHeader
          weekStart={first}
          weekEnd={last}
          planned={planned}
          done={done}
          plannedTss={plannedTss}
          actualTss={actualTss}
        />
        {items.length ? items : <p className="px-3 py-3 text-[10px] text-muted">No sessions planned.</p>}
      </div>,
    );
  }
  flushQuietWeeks();

  return <div className="space-y-2">{rendered}</div>;
}
