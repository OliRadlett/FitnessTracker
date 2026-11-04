'use client';

import React, { useState } from 'react';
import { Bike, CalendarRange, Dumbbell, Moon, Plus } from 'lucide-react';

import type { AddableSport } from '@/lib/training/sessionGroups';
import type { Coverage } from '@/lib/training/coverage';
import { fmtDayShort } from './WeekRows';

const WEEKDAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const SPORT_CHOICE: { sport: PlanSportChoice; label: string; icon: React.ReactNode }[] = [
  { sport: 'strength', label: 'Strength', icon: <Dumbbell className="h-4 w-4" /> },
  { sport: 'cycle', label: 'Ride', icon: <Bike className="h-4 w-4" /> },
  { sport: 'rest', label: 'Rest', icon: <Moon className="h-4 w-4" /> },
];

type PlanSportChoice = AddableSport | 'rest';

/**
 * An empty week, stated once.
 *
 * The old page rendered this as seven identical "No plan entry" boxes, under a
 * header that had already said "no sessions". Here it is one sentence with the
 * reason and the numbers, then the seven days as a strip you can act on.
 *
 * Deliberately **not** offered: "Extend the plan" and "Write this week". Both need
 * endpoints that do not exist (`POST /{id}/extend`, `POST /{id}/weeks/{n}`) — a
 * button that cannot keep its promise is worse than no button. Adding one session
 * at a time works today via `POST /{id}/days`, so that is what this offers.
 */
export function EmptyWeek({
  weekNumber,
  dates,
  coverage,
  unplannedCount,
  unplannedDays,
  today,
  busy,
  onAdd,
  onViewPlan,
}: {
  weekNumber: number;
  dates: string[];
  coverage: Coverage;
  unplannedCount: number;
  unplannedDays: number;
  today: string;
  busy: boolean;
  onAdd: (date: string, sport: PlanSportChoice) => void;
  onViewPlan: () => void;
}) {
  const [adding, setAdding] = useState<string | null>(null);

  return (
    <>
      <div className="rounded-xl border border-caution/25 bg-caution/[0.06] p-4">
        <p className="text-sm text-muted">
          Week {weekNumber} has no sessions.
          {coverage.lastSessionDate && (
            <>
              {' '}
              The plan&apos;s last session was{' '}
              <span className="font-medium text-foreground">{fmtDayShort(coverage.lastSessionDate)}</span>
              {coverage.daysSinceLastSession != null && <> — {coverage.daysSinceLastSession} days ago</>}.
            </>
          )}{' '}
          {coverage.uncoveredWeeks > 0 && (
            <>
              {coverage.uncoveredWeeks} of {coverage.totalWeeks} weeks are empty, through{' '}
              {fmtDayShort(coverage.weeks[coverage.weeks.length - 1].end)}.
            </>
          )}
          {unplannedCount > 0 && (
            <>
              {' '}
              {unplannedCount} {unplannedCount === 1 ? 'session' : 'sessions'} in the last{' '}
              {unplannedDays} days had no plan day.
            </>
          )}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setAdding(adding ? null : dates.find((d) => d >= today) ?? dates[0])}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-accent px-3 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
          >
            <Plus className="h-4 w-4" />
            Add a session
          </button>
          <button
            type="button"
            onClick={onViewPlan}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-white/10 px-3 text-sm font-medium text-foreground transition-colors hover:bg-white/[0.05]"
          >
            <CalendarRange className="h-4 w-4" />
            See the whole plan
          </button>
        </div>
      </div>

      <div className="mt-3">
        <span className="text-xs font-medium uppercase tracking-wider text-muted">
          Add to a single day
        </span>
        <div className="mt-2 grid grid-cols-7 gap-1.5">
          {dates.map((d) => {
            const isToday = d === today;
            const isAdding = adding === d;
            return (
              <div key={d} className="flex flex-col gap-1">
                <button
                  type="button"
                  onClick={() => setAdding(isAdding ? null : d)}
                  aria-label={`Add a session on ${fmtDayShort(d)}`}
                  aria-expanded={isAdding}
                  className={`flex min-h-[60px] flex-col items-center justify-center gap-0.5 rounded-lg border transition-colors ${
                    isAdding
                      ? 'border-accent/60 bg-accent/10 text-accent'
                      : isToday
                        ? 'border-accent/40 bg-accent/[0.07] text-accent'
                        : 'border-white/[0.08] bg-surface text-muted hover:border-white/20 hover:text-foreground'
                  }`}
                >
                  <span className="text-xs">{WEEKDAY[(new Date(d + 'T00:00:00').getDay() + 6) % 7]}</span>
                  <span className={`text-base font-semibold ${isToday || isAdding ? 'text-accent' : 'text-foreground'}`}>
                    {new Date(d + 'T00:00:00').getDate()}
                  </span>
                  <Plus className="h-3.5 w-3.5" />
                </button>
                {isAdding && (
                  <div className="flex flex-col gap-1">
                    {SPORT_CHOICE.map((c) => (
                      <button
                        key={c.sport}
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          onAdd(d, c.sport);
                          setAdding(null);
                        }}
                        className="inline-flex min-h-[36px] items-center justify-center gap-1 rounded-md border border-white/10 bg-surface px-1 text-xs text-foreground hover:border-accent/40 hover:text-accent disabled:opacity-40"
                      >
                        {c.icon}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
