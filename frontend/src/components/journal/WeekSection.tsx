'use client';

import React from 'react';
import type { JournalWeek } from '@/lib/journal';
import { weekTotalsParts } from '@/lib/journal';
import { WeekSparkline } from './WeekSparkline';
import { SessionRow } from './SessionRow';

function WeekTotals({ week }: { week: JournalWeek }) {
  return (
    <p className="text-[10.5px] tabular-nums text-muted/55">
      {weekTotalsParts(week).map((part, i) => (
        <React.Fragment key={part}>
          {i > 0 && <span className="px-1.5 text-muted/25">·</span>}
          {part}
        </React.Fragment>
      ))}
    </p>
  );
}

export function WeekSection({
  week,
  maxSeconds,
  first,
}: {
  week: JournalWeek;
  maxSeconds: number;
  first: boolean;
}) {
  const isCurrent = week.strip.some((day) => day.isToday);

  return (
    <section className={first ? '' : 'pt-8'}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <div className="flex items-baseline gap-2">
          <h2
            className={`text-[11.5px] font-medium tracking-[0.01em] ${isCurrent ? 'text-accent/85' : 'text-muted/80'}`}
          >
            {week.label}
          </h2>
          <span className="text-[9.5px] tabular-nums text-muted/30">W{week.weekNumber}</span>
        </div>
        <div className="ml-auto sm:ml-0">
          <WeekSparkline week={week} maxSeconds={maxSeconds} />
        </div>
        <div className="w-full sm:ml-auto sm:w-auto">
          <WeekTotals week={week} />
        </div>
      </div>

      <div className="mt-3 border-t border-white/[0.06]">
        {week.days.map((day) => (
          <div
            key={day.date}
            className="grid grid-cols-[40px_minmax(0,1fr)] gap-3 border-b border-white/[0.035] py-1.5 last:border-b-0 sm:grid-cols-[44px_minmax(0,1fr)]"
          >
            <div className="pt-2 text-center">
              <div className="text-[9px] font-medium uppercase tracking-[0.1em] text-muted/45">
                {day.weekday}
              </div>
              <div
                className={`text-[15px] font-semibold leading-tight tabular-nums ${
                  day.isToday ? 'text-accent' : 'text-foreground/65'
                }`}
              >
                {day.dayNumber}
              </div>
            </div>
            <div className="min-w-0">
              {day.rows.map((row) => (
                <SessionRow key={row.id} row={row} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
