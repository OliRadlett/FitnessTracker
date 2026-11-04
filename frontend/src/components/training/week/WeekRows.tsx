'use client';

import React from 'react';
import { Bike, Check, ChevronRight, Dumbbell, Minus, Moon, TriangleAlert } from 'lucide-react';

import type { Goal, TrainingWeekDay } from '@/lib/api';
import { readDay, plannedAside, type DayRead, type RowStatus } from '@/lib/training/coverage';
import { DayEditor } from '../plan/DayEditor';

const WEEKDAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const fmtDayShort = (iso: string): string => {
  const d = new Date(iso.slice(0, 10) + 'T00:00:00');
  return `${WEEKDAY[(d.getDay() + 6) % 7]} ${d.getDate()} ${MONTH[d.getMonth()]}`;
};

const STATUS: Record<RowStatus, { label: string; className: string; icon: React.ReactNode }> = {
  done: { label: 'Done', className: 'bg-positive/10 text-positive border-positive/25', icon: <Check className="h-3 w-3" /> },
  missed: { label: 'Missed', className: 'bg-warning/10 text-warning border-warning/30', icon: <TriangleAlert className="h-3 w-3" /> },
  partial: { label: 'Partial', className: 'bg-caution/10 text-caution border-caution/30', icon: <Minus className="h-3 w-3" /> },
  rest: { label: 'Rest', className: 'bg-white/[0.04] text-muted border-white/10', icon: <Moon className="h-3 w-3" /> },
  today: { label: 'Today', className: 'bg-accent/10 text-accent border-accent/30', icon: null },
  planned: { label: 'Planned', className: 'bg-white/[0.04] text-muted border-white/10', icon: null },
  gap: { label: 'No session', className: 'bg-transparent text-muted/70 border-white/[0.07]', icon: null },
};

export function StatusPill({ status }: { status: RowStatus }) {
  const s = STATUS[status];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${s.className}`}>
      {s.icon}
      {s.label}
    </span>
  );
}

function SportGlyph({ sport, className = 'h-4 w-4' }: { sport: string; className?: string }) {
  if (sport === 'strength') return <Dumbbell className={className} aria-label="Strength" />;
  if (sport === 'cycle') return <Bike className={className} aria-label="Ride" />;
  if (sport === 'rest') return <Moon className={className} aria-label="Rest" />;
  return <Minus className={className} aria-label="No session" />;
}

function Number({ value, unit, muted }: { value: string; unit: string; muted?: boolean }) {
  return (
    <span className={`tnum text-base font-semibold ${muted ? 'text-muted' : 'text-foreground'}`}>
      {value}
      <span className="ml-0.5 text-xs font-normal text-muted">{unit}</span>
    </span>
  );
}

/**
 * One row per calendar day.
 *
 * Seven equal cards forced a rest day and a key session to the same weight and
 * turned an empty week into seven identical "No plan entry" boxes. A row carries
 * one title, one number and one status; the description is the title, and the
 * plan becomes a subtitle only when an actual has replaced it.
 */
export function WeekRows({
  planId,
  weekNumber,
  dates,
  days,
  today,
  expandedDate,
  onExpand,
  goals,
  onOpenRoutePicker,
  onOpenWahooPush,
  onMoveMissed,
  onAddOn,
}: {
  planId: string;
  weekNumber: number;
  dates: string[];
  days: TrainingWeekDay[];
  today: string;
  expandedDate: string | null;
  onExpand: (date: string | null) => void;
  goals: Goal[];
  onOpenRoutePicker: () => void;
  onOpenWahooPush: () => void;
  onMoveMissed: (date: string) => void;
  onAddOn: (date: string) => void;
}) {
  const byDate = new Map<string, TrainingWeekDay[]>();
  for (const d of days) {
    const key = d.day_date.slice(0, 10);
    const list = byDate.get(key);
    if (list) list.push(d);
    else byDate.set(key, [d]);
  }

  const renderRow = (date: string, day: TrainingWeekDay | undefined, first: boolean) => {
    const r: DayRead = readDay(date, day, today);
    const isToday = date === today;
    const dim = r.status === 'gap' || r.status === 'rest';
    const second = plannedAside(r) ?? (dim ? null : r.aside);
    const expanded = expandedDate === date && day != null;

    return (
      <div
        key={`${date}-${day?.id ?? 'gap'}`}
        id={first ? `plan-day-${date}` : undefined}
        className={`border-b border-white/[0.05] last:border-b-0 ${expanded ? 'bg-white/[0.03]' : ''}`}
      >
        <div className={`group flex min-h-[56px] items-center gap-3 px-1 py-2 ${isToday ? 'bg-accent/[0.04]' : ''}`}>
          <div className="w-[64px] shrink-0 md:w-[104px]">
            {first ? (
              <span className="flex items-baseline gap-1">
                <span
                  className={`text-sm ${
                    isToday ? 'font-semibold text-accent' : dim ? 'text-muted' : 'text-foreground'
                  }`}
                >
                  {WEEKDAY[(new Date(date + 'T00:00:00').getDay() + 6) % 7]}
                </span>
                <span className={`text-sm ${isToday ? 'text-accent' : 'text-muted'}`}>
                  {new Date(date + 'T00:00:00').getDate()}
                </span>
                <span className="text-xs text-muted">{MONTH[new Date(date + 'T00:00:00').getMonth()]}</span>
              </span>
            ) : (
              // A second session on the same date: the date is not repeated.
              <span className="pl-2 text-xs text-muted/60" aria-hidden>
                ↳
              </span>
            )}
          </div>

          <div className={`hidden w-5 shrink-0 md:block ${dim ? 'text-muted/60' : 'text-muted'}`}>
            <SportGlyph sport={r.sport} />
          </div>

          <div className="min-w-0 flex-1 self-stretch">
            {/* Centred, not `items-start`: at 390 the pill was rendering above the
                title, which read as two rows for one session. */}
            <div className="flex items-center gap-2">
              <span className="shrink-0 md:hidden">
                <SportGlyph sport={r.sport} className="h-3.5 w-3.5 text-muted" />
              </span>
              <button
                type="button"
                disabled={r.status === 'gap'}
                onClick={() => onExpand(expanded ? null : date)}
                className={`min-h-[44px] min-w-0 flex-1 py-2 text-left text-sm leading-snug ${
                  r.status === 'gap' ? 'cursor-default text-muted/70' : dim ? 'text-muted' : 'font-medium text-foreground'
                } ${r.status === 'gap' ? '' : 'hover:underline'}`}
              >
                <span className="line-clamp-2 md:line-clamp-1">{r.title}</span>
                {second && (
                  <span className="mt-0.5 block truncate text-xs font-normal text-muted">{second}</span>
                )}
              </button>
              {/* No pill on an empty day: the title already says "No session", and
                  repeating it in the pill made three of seven rows say nothing twice. */}
              <span className="shrink-0 md:hidden">
                {r.status !== 'gap' && <StatusPill status={r.status} />}
              </span>
            </div>
          </div>

          <div className="w-[60px] shrink-0 text-right md:w-[92px]">
            {r.headline ? (
              <Number value={r.headline.value} unit={r.headline.unit} muted={dim} />
            ) : (
              <span className="text-sm text-muted">—</span>
            )}
          </div>

          <div className="hidden w-[104px] shrink-0 md:block">
            {r.status !== 'gap' && <StatusPill status={r.status} />}
          </div>

          <div className="hidden w-[64px] shrink-0 justify-end md:flex">
            {r.status === 'missed' ? (
              <button
                type="button"
                onClick={() => onMoveMissed(date)}
                className="rounded-md px-2 py-1 text-xs font-medium text-accent hover:bg-accent/10"
              >
                Move
              </button>
            ) : r.status === 'gap' ? (
              <button
                type="button"
                aria-label={`Add a session on ${fmtDayShort(date)}`}
                onClick={() => onAddOn(date)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-white/[0.06] hover:text-accent"
              >
                +
              </button>
            ) : (
              <button
                type="button"
                aria-label={`${expanded ? 'Close' : 'Open'} ${fmtDayShort(date)}`}
                onClick={() => onExpand(expanded ? null : date)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted opacity-40 transition-opacity hover:bg-white/[0.06] hover:text-foreground hover:opacity-100 focus:opacity-100 group-hover:opacity-100"
              >
                <ChevronRight className={`h-4 w-4 ${expanded ? 'rotate-90' : ''}`} />
              </button>
            )}
          </div>
        </div>

        {expanded && day && (
          <div className="px-1 pb-4 pl-[76px] pr-2 md:pl-[140px]">
            <DayEditor
              planId={planId}
              week={weekNumber}
              day={day}
              goals={goals}
              onOpenRoutePicker={onOpenRoutePicker}
              onOpenWahooPush={onOpenWahooPush}
              onDeleted={() => onExpand(null)}
            />
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="rounded-xl border border-white/[0.07] bg-surface">
      {dates.flatMap((date) => {
        const sessions = byDate.get(date) ?? [];
        // An unwritten date is one row; a written date is one row per session, so a
        // lift and a ride on the same day never overwrite each other (#297).
        if (sessions.length === 0) return [renderRow(date, undefined, true)];
        return sessions.map((d, i) => renderRow(date, d, i === 0));
      })}
    </div>
  );
}
