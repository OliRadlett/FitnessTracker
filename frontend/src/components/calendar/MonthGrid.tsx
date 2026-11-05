'use client';

import React from 'react';
import { Flag } from 'lucide-react';
import type { CalendarResponse } from '@/lib/api';
import { isoDate, monthWeeks, isoWeek, weekLabel } from '@/lib/calendar';
import { DayCell } from './DayCell';
import { Card, cx } from './calendarUi';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function WeekGutter({
  weekStart,
  weekEnd,
  planned,
  actual,
}: {
  weekStart: Date;
  weekEnd: Date;
  planned: number;
  actual: number;
}) {
  const max = Math.max(planned, actual, 1);
  const actualPct = (actual / max) * 100;
  const plannedPct = (planned / max) * 100;
  return (
    <div
      className="flex flex-col justify-center gap-1 pr-1.5"
      title={`Week ${isoWeek(weekStart)} · ${weekLabel(weekStart, weekEnd)} · planned ${Math.round(planned)} TSS · actual ${Math.round(actual)} TSS`}
    >
      <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted/60">
        W{isoWeek(weekStart)}
      </span>
      <div className="relative h-[3px] w-full overflow-hidden rounded-full bg-surface-light/60">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-accent/70"
          style={{ width: `${actualPct}%` }}
        />
        {planned > 0 && (
          <div
            className="absolute inset-y-0 w-[2px] bg-foreground/70"
            style={{ left: `${Math.min(plannedPct, 98)}%` }}
            title={`Planned ${Math.round(planned)} TSS`}
          />
        )}
      </div>
      <div className="flex items-baseline gap-1 text-[10px] leading-3">
        <span className="font-semibold text-foreground/85">{actual ? Math.round(actual) : '—'}</span>
        <span className="text-muted/50">TSS</span>
      </div>
      <div className="text-[9px] leading-3 text-muted/50">
        {planned > 0 ? `P ${Math.round(planned)}` : 'P —'}
      </div>
    </div>
  );
}

export function MonthGrid({
  fixture,
  month,
  today,
  selectedDate,
  onSelect,
}: {
  fixture: CalendarResponse;
  month: Date;
  today: string;
  selectedDate: string;
  onSelect: (date: string) => void;
}) {
  const weeks = monthWeeks(fixture, month);

  return (
    <Card className="!p-0 overflow-hidden !border-surface-light/50">
      <div className="flex items-center justify-between gap-3 border-b border-surface-light/60 px-4 py-3">
        <div>
          <p className="flex flex-wrap items-baseline gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted/60">
            {fixture.plan?.name ?? 'No active plan'}
          </p>
          <p className="text-xs text-muted/70">
            Planned outline · completed solid · missed hatched
          </p>
        </div>
        <div className="hidden items-center gap-3 text-[10px] text-muted/60 sm:flex">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-positive" /> recovery
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Flag className="h-3 w-3 text-caution" /> event
          </span>
        </div>
      </div>

      <div className="px-2 pb-3 pt-2">
        <div
          className="grid gap-1"
          style={{ gridTemplateColumns: '44px repeat(7, minmax(0, 1fr))' }}
        >
          <div />
          {WEEKDAYS.map((day) => (
            <div
              key={day}
              className="pb-1 text-center text-[10px] font-semibold uppercase tracking-[0.14em] text-muted/55"
            >
              {day}
            </div>
          ))}

          {weeks.map((week) => {
            const summary =
              week.summary ??
              fixture.weeks.find((w) => w.week_start === isoDate(week.weekStart));
            return (
              <React.Fragment key={isoDate(week.weekStart)}>
                <WeekGutter
                  weekStart={week.weekStart}
                  weekEnd={week.weekEnd}
                  planned={summary?.planned_tss ?? 0}
                  actual={summary?.actual_tss ?? 0}
                />
                {week.days.map(({ date, day, inMonth }) => (
                  <DayCell
                    key={isoDate(date)}
                    fixture={fixture}
                    date={date}
                    day={day}
                    today={today}
                    inMonth={inMonth}
                    selected={isoDate(date) === selectedDate}
                    onSelect={onSelect}
                  />
                ))}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-surface-light/60 px-4 py-3">
        <LegendItem swatch={<span className="h-3 w-5 rounded border border-dashed border-muted/50" />} label="Planned" />
        <LegendItem swatch={<span className="h-3 w-5 rounded border border-positive/40 bg-positive/10" />} label="Completed" />
        <LegendItem swatch={<span className="calendar-missed-hatch h-3 w-5 rounded border border-warning/40" />} label="Missed" />
        <LegendItem swatch={<span className="h-3 w-5 rounded border border-dotted border-info/40 bg-info/[0.04]" />} label="Unplanned" />
        <LegendItem swatch={<span className="h-2 w-2 rounded-full bg-caution" />} label="Recovery" />
        <LegendItem swatch={<Flag className="h-3 w-3 text-caution" />} label="Event" />
        <span className={cx('ml-auto hidden text-[10px] text-muted/50 lg:inline')}>
          Week bar: actual fill · planned tick
        </span>
      </div>
    </Card>
  );
}

function LegendItem({ swatch, label }: { swatch: React.ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] text-muted/65">
      {swatch}
      {label}
    </span>
  );
}
