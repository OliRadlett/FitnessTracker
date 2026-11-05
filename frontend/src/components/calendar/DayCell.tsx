'use client';

import React from 'react';
import { AlertTriangle, Check, Circle, Flag, Target } from 'lucide-react';
import type {
  CalendarActivity as Activity,
  CalendarDay as Day,
  CalendarResponse as Fixture,
  CalendarLift as Lift,
} from '@/lib/api';
import {
  dayStatus,
  eventForDay,
  goalForDay,
  isoDate,
  loggedCount,
  planState,
  planStates,
  statusLabel,
  type Status,
} from '@/lib/calendar';
import { fmtDistance, fmtDuration, fmtVolume, focusLabel } from '@/lib/calendarFormat';
import { RecoveryDot, SportGlyph, cx } from './calendarUi';

const SPORT_STYLES: Record<string, { border: string; bg: string; text: string }> = {
  cycle: { border: 'border-blue-500/40', bg: 'bg-blue-500/10', text: 'text-blue-500' },
  strength: { border: 'border-purple-500/40', bg: 'bg-purple-500/10', text: 'text-purple-500' },
  run: { border: 'border-green-500/40', bg: 'bg-green-500/10', text: 'text-green-600' },
  swim: { border: 'border-cyan-500/40', bg: 'bg-cyan-500/10', text: 'text-cyan-600' },
  walk: { border: 'border-amber-500/40', bg: 'bg-amber-500/10', text: 'text-amber-600' },
  other: { border: 'border-surface-light', bg: 'bg-surface-light/30', text: 'text-muted' },
};

function styleFor(sport: string | null | undefined) {
  const s = (sport ?? '').toLowerCase();
  if (s === 'cycle' || s.includes('cycl') || s.includes('bike')) return SPORT_STYLES.cycle;
  if (s === 'strength' || s.includes('strength') || s.includes('weight')) return SPORT_STYLES.strength;
  if (s.includes('run')) return SPORT_STYLES.run;
  if (s.includes('swim')) return SPORT_STYLES.swim;
  if (s.includes('walk') || s.includes('hik')) return SPORT_STYLES.walk;
  return SPORT_STYLES.other;
}

function StatusGlyph({ status }: { status: Status }) {
  if (status === 'done') return <Check className="h-3 w-3 shrink-0 text-positive" aria-hidden />;
  if (status === 'partial' || status === 'mismatch' || status === 'done-unlogged')
    return <AlertTriangle className="h-3 w-3 shrink-0 text-caution" aria-hidden />;
  if (status === 'missed')
    return <AlertTriangle className="h-3 w-3 shrink-0 text-warning" aria-hidden />;
  if (status === 'unplanned')
    return <Circle className="h-2 w-2 shrink-0 text-info" aria-hidden />;
  return null;
}

function PlannedChip({
  state,
  plan,
}: {
  state: ReturnType<typeof planState>;
  plan: Day['plan'][number];
}) {
  const sport = plan.sport === 'cycle' ? 'cycle' : plan.sport;
  const style = styleFor(sport);
  const label =
    plan.sport === 'rest'
      ? 'Rest'
      : plan.sport === 'strength'
        ? `${focusLabel(plan.planned_focus)}${plan.planned_duration_min ? ` ${plan.planned_duration_min}m` : ''}`
        : plan.planned_tss != null
          ? `${Math.round(plan.planned_tss)} TSS`
          : `${plan.planned_type}${plan.planned_duration_min ? ` ${plan.planned_duration_min}m` : ''}`;

  if (plan.sport === 'rest') {
    return (
      <div className="flex min-w-0 items-center gap-1 rounded-md border border-surface-light/60 bg-transparent px-1.5 py-1 text-[11px] leading-4 text-muted/70">
        <SportGlyph sport="rest" className="text-muted/60" />
        <span className="truncate">Rest</span>
      </div>
    );
  }

  return (
    <div
      className={cx(
        'planned-outline flex min-w-0 items-center gap-1 rounded-md border bg-transparent px-1.5 py-1 text-[11px] leading-4',
        style.border,
        style.text,
        state.status === 'missed' && 'calendar-missed-hatch border-warning/50 text-warning',
        state.status === 'mismatch' && 'border-caution/60 text-caution',
      )}
      title={
        plan.sport === 'cycle' && plan.planned_tss != null
          ? `Planned: ${plan.planned_type} · ${Math.round(plan.planned_tss)} TSS`
          : `Planned: ${label}`
      }
    >
      <SportGlyph sport={sport} />
      <span className="truncate">{label}</span>
    </div>
  );
}

function ActualChip({
  kind,
  activity,
  lift,
  unplanned,
}: {
  kind: 'activity' | 'lift';
  activity?: Activity;
  lift?: Lift;
  unplanned: boolean;
}) {
  const sport = kind === 'lift' ? 'strength' : activity?.sport_type;
  const style = styleFor(sport);
  const label =
    kind === 'lift'
      ? `${lift?.focus ? focusLabel(lift.focus) : 'Lift'}${lift?.total_volume_kg ? ` ${fmtVolume(lift.total_volume_kg)}` : lift?.set_count ? ` ${lift.set_count} sets` : ' no sets'}`
      : activity?.distance_meters && activity.distance_meters > 0
        ? fmtDistance(activity.distance_meters)
        : fmtDuration(activity?.duration_seconds);
  const tss = kind === 'lift' ? lift?.estimated_tss : activity?.tss;

  return (
    <div
      className={cx(
        'flex min-w-0 items-center gap-1 rounded-md border px-1.5 py-1 text-[11px] leading-4',
        unplanned ? 'border-dotted border-info/40 bg-info/[0.04] text-info/90' : `${style.border} ${style.bg} ${style.text}`,
      )}
      title={`${unplanned ? 'Unplanned: ' : 'Logged: '}${label}${tss != null ? ` · ${Math.round(tss)} TSS` : ''}`}
    >
      <SportGlyph sport={sport} />
      <span className="truncate">{label}</span>
      {unplanned && <Circle className="h-2 w-2 shrink-0 text-info/80" aria-hidden />}
      {tss != null && (
        <span className="ml-auto shrink-0 text-[9px] text-muted/80">{Math.round(tss)}</span>
      )}
    </div>
  );
}

export function DayCell({
  fixture,
  date,
  day,
  today,
  inMonth,
  selected,
  onSelect,
}: {
  fixture: Fixture;
  date: Date;
  day: Day | undefined;
  today: string;
  inMonth: boolean;
  selected: boolean;
  onSelect: (date: string) => void;
}) {
  const dateKey = isoDate(date);
  const isToday = dateKey === today;
  const status = day ? dayStatus(day, today, fixture) : 'quiet';
  const states = day ? planStates(day, today, fixture) : [];
  const nonRestPlans = day ? day.plan.filter((p) => p.sport !== 'rest') : [];
  const restPlan = day?.plan.find((p) => p.sport === 'rest');
  const event = day ? eventForDay(fixture, day) : undefined;
  const goal = day ? goalForDay(fixture, day) : undefined;

  const linkedActivityIds = new Set(
    (day?.plan ?? []).map((p) => p.actual_activity_id).filter(Boolean) as string[],
  );
  const linkedLiftIds = new Set(
    (day?.plan ?? []).map((p) => p.actual_lifting_session_id).filter(Boolean) as string[],
  );

  const chips: React.ReactNode[] = [];
  const maxChips = 3;

  nonRestPlans.slice(0, 2).forEach((plan) => {
    const state = states.find((_, index) => day?.plan[index]?.id === plan.id)
      ?? planState(plan, day!, today, fixture);
    chips.push(<PlannedChip key={plan.id} state={state} plan={plan} />);
  });

  if (day) {
    // A strength activity + linked lifting session are the same session; the
    // lift chip is richer, so show it once.
    for (const lift of day.lifts) {
      chips.push(
        <ActualChip
          key={`lift-${lift.id}`}
          kind="lift"
          lift={lift}
          unplanned={!linkedLiftIds.has(lift.id)}
        />,
      );
    }
    for (const activity of day.activities) {
      if (activity.sport_type === 'strength' && day.lifts.length > 0) continue;
      chips.push(
        <ActualChip
          key={`act-${activity.id}`}
          kind="activity"
          activity={activity}
          unplanned={!linkedActivityIds.has(activity.id)}
        />,
      );
    }
  }

  if (restPlan && chips.length === 0) {
    chips.push(
      <div
        key="rest"
        className="flex min-w-0 items-center gap-1 rounded-md border border-surface-light/60 px-1.5 py-1 text-[11px] leading-4 text-muted/70"
      >
        <SportGlyph sport="rest" className="text-muted/60" />
        <span className="truncate">Rest</span>
      </div>,
    );
  }

  const overflow = Math.max(0, chips.length - maxChips);
  const shown = chips.slice(0, maxChips);
  const recovery = day?.metric?.recovery_score ?? null;

  const statusClass =
    status === 'done'
      ? 'border-positive/25 border-l-2 border-l-positive/60'
      : status === 'partial'
        ? 'border-caution/45 border-l-2 border-l-caution/70'
        : status === 'mismatch'
          ? 'border-caution/50 border-l-2 border-l-caution/70'
          : status === 'done-unlogged'
            ? 'border-caution/30 border-l-2 border-l-caution/50'
            : status === 'missed'
              ? 'calendar-missed-hatch border-warning/45 border-l-2 border-l-warning/70'
              : status === 'unplanned'
                ? 'border-info/25 border-l-2 border-l-info/50'
                : status === 'planned'
                  ? 'border-surface-light/70'
                  : 'border-surface-light/40';

  const ariaParts = [
    date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }),
    nonRestPlans.length ? `${nonRestPlans.length} planned` : null,
    day && loggedCount(day)
      ? `${loggedCount(day)} logged`
      : null,
    status === 'quiet' ? 'nothing planned or logged' : statusLabel(status),
  ].filter(Boolean);

  return (
    <button
      type="button"
      onClick={() => onSelect(dateKey)}
      aria-label={ariaParts.join(', ')}
      aria-pressed={selected}
      className={cx(
        'group relative flex min-h-[130px] flex-col gap-1.5 rounded-xl border p-2 text-left transition-colors',
        'hover:bg-surface-light/25 focus-visible:bg-surface-light/25',
        statusClass,
        selected
          ? 'border-accent/60 bg-accent/[0.06] ring-2 ring-accent/50'
          : isToday
            ? 'ring-1 ring-accent/45'
            : '',
        !inMonth && 'opacity-40',
      )}
    >
      <div className="flex items-start justify-between gap-1">
        <span
          className={cx(
            'inline-flex items-center gap-1.5 text-xs font-semibold leading-5',
            isToday ? 'text-accent' : inMonth ? 'text-foreground/85' : 'text-muted/60',
          )}
        >
          {date.getDate()}
          {isToday && (
            <span className="rounded-full bg-accent/15 px-1 text-[8px] font-bold uppercase tracking-[0.12em] text-accent">
              Today
            </span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          <StatusGlyph status={status} />
          {event && (
            <Flag
              className="h-3 w-3 text-caution"
              aria-label={event.name}
            />
          )}
          {goal && (
            <Target
              className="h-3 w-3 text-info"
              aria-label="Goal target date"
            />
          )}
          <RecoveryDot score={recovery} />
        </span>
      </div>

      <div className="flex min-w-0 flex-col gap-1">
        {shown}
        {overflow > 0 && (
          <span className="px-1 text-[9px] font-medium text-muted/70">+{overflow} more</span>
        )}
      </div>

      {isToday && status === 'done' && (
        <span className="pointer-events-none absolute inset-x-0 bottom-0 h-[2px] rounded-b-xl bg-positive/50" />
      )}
    </button>
  );
}
