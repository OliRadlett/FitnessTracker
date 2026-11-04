'use client';

import React from 'react';
import type { JournalWeek } from '@/lib/journal';

/**
 * The week's shape in 60×26px: seven columns, each a stack of that day's
 * sessions sized by duration. Rides are emerald, lifts muted. Rest days are a
 * 2px tick, so a week with no training reads as empty rather than as a broken
 * chart.
 *
 * A full-width load band was built first and rejected: at 880px it became seven
 * grey slabs that pushed the diary below the fold.
 */
export function WeekSparkline({ week, maxSeconds }: { week: JournalWeek; maxSeconds: number }) {
  const HEIGHT = 26;
  return (
    <div className="flex h-[26px] items-end gap-[4px]" aria-hidden>
      {week.strip.map((day) => {
        const pct = maxSeconds > 0 ? Math.min(1, day.seconds / maxSeconds) : 0;
        const total = day.seconds > 0 ? Math.max(5, pct * HEIGHT) : 2;
        return (
          <div
            key={day.date}
            className="flex w-[9px] flex-col-reverse gap-[1px]"
            style={{ height: total }}
            title={`${day.day} ${Number(day.date.slice(8))}: ${day.sessions} session${day.sessions === 1 ? '' : 's'}`}
          >
            {day.parts.length > 0 ? (
              day.parts.map((part, i) => (
                <div
                  key={i}
                  className="w-full rounded-[1px]"
                  style={{
                    flexGrow: Math.max(part.seconds, 60),
                    background: part.isRide ? 'rgb(var(--accent) / 0.75)' : 'rgb(var(--muted) / 0.45)',
                  }}
                />
              ))
            ) : (
              <div className="h-[2px] w-full rounded-[1px] bg-white/[0.07]" />
            )}
          </div>
        );
      })}
    </div>
  );
}
