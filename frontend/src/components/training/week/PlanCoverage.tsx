'use client';

import React, { useState } from 'react';
import { Layers } from 'lucide-react';

import type { TrainingPlan, TrainingPlanDay } from '@/lib/api';
import type { Coverage, WeekSummary } from '@/lib/training/coverage';
import { BlockEditor } from '../plan/BlockEditor';

const WEEKDAY = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const shortDate = (iso: string): string => {
  const d = new Date(iso.slice(0, 10) + 'T00:00:00');
  return `${d.getDate()} ${MONTH[d.getMonth()]}`;
};

const rangeLabel = (start: string, end: string): string => {
  const a = new Date(start + 'T00:00:00');
  const b = new Date(end + 'T00:00:00');
  return a.getMonth() === b.getMonth()
    ? `${a.getDate()}–${b.getDate()} ${MONTH[b.getMonth()]}`
    : `${a.getDate()} ${MONTH[a.getMonth()]} – ${b.getDate()} ${MONTH[b.getMonth()]}`;
};

/** Fill for one date, from the plan payload alone (no per-week request). */
function cellClass(day: TrainingPlanDay | undefined, date: string, today: string): string {
  if (!day) return 'border border-dashed border-white/[0.10] bg-transparent';
  if (day.sport === 'rest') return 'bg-white/[0.10]';
  if (day.completed) return 'bg-accent/55';
  if (date < today) return 'bg-warning/75';
  return 'bg-accent/25';
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-[2px] bg-accent/55" /> done
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-[2px] bg-warning/75" /> missed
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-[2px] bg-white/[0.10]" /> rest
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-[2px] border border-dashed border-white/25" /> not written
      </span>
    </div>
  );
}

/**
 * The plan as one object: 20 week columns, 7 day rows, and the boundary where the
 * written plan stops.
 *
 * This is the view the old page did not have. It had a `Blocks` histogram with no
 * axis, no labels, and no meaning — drawn from a derived guess while the plan's
 * stored block list was empty.
 */
export function PlanCoverage({
  plan,
  coverage,
  today,
  onWeek,
}: {
  plan: TrainingPlan;
  coverage: Coverage;
  today: string;
  onWeek: (n: number) => void;
}) {
  const byDate = new Map<string, TrainingPlanDay>();
  for (const d of plan.days ?? []) byDate.set(d.day_date.slice(0, 10), d);
  const [blocksOpen, setBlocksOpen] = useState(false);

  const boundary = coverage.writtenWeeks / coverage.totalWeeks;

  const weekIndex = (start: string): number => {
    const d = new Date(start + 'T00:00:00');
    const prev = coverage.weeks.find((w) => w.start === start);
    return prev ? new Date(prev.start).getMonth() : d.getMonth();
  };

  const stateOf = (w: WeekSummary): string => {
    if (!w.written) return 'No sessions';
    if (w.isCurrent) return 'This week';
    if (w.missed > 0) return `${w.missed} missed`;
    return w.isPast ? 'All done' : 'Planned';
  };

  return (
    <>
      <section className="mb-4 rounded-xl border border-caution/25 bg-caution/[0.06] p-4">
        <p className="text-sm font-medium text-foreground">
          {coverage.uncoveredWeeks} of {coverage.totalWeeks} weeks have no sessions.
        </p>
        <p className="mt-1 text-sm text-muted">
          {coverage.lastSessionDate ? (
            <>
              The plan is written to {shortDate(coverage.lastSessionDate)} and claims to run to{' '}
              {shortDate(plan.end_date)}.
            </>
          ) : (
            <>The plan has no sessions written yet.</>
          )}{' '}
          {coverage.firstUnwrittenWeek != null && (
            <>
              Weeks {coverage.firstUnwrittenWeek}–{coverage.totalWeeks} are empty
              {coverage.daysSinceLastSession != null && (
                <> — nothing has been planned for the last {coverage.daysSinceLastSession} days</>
              )}
              .
            </>
          )}
        </p>
        <div className="mt-3 flex flex-wrap items-baseline gap-x-6 gap-y-2 text-foreground">
          <span className="tnum text-base font-semibold">
            {coverage.writtenWeeks}/{coverage.totalWeeks}
            <span className="ml-1 text-xs font-normal text-muted">weeks</span>
          </span>
          <span className="tnum text-base font-semibold">
            {coverage.sessions}
            <span className="ml-1 text-xs font-normal text-muted">sessions</span>
          </span>
          {coverage.lastSessionDate && (
            <span className="tnum text-base font-semibold">
              {shortDate(coverage.lastSessionDate)}
              <span className="ml-1 text-xs font-normal text-muted">last session</span>
            </span>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-white/[0.07] bg-surface p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-medium uppercase tracking-wider text-muted">Coverage</span>
          <Legend />
        </div>

        {/* Desktop grid */}
        <div className="hidden md:block">
          <div className="flex gap-2">
            <div className="w-4 shrink-0">
              <div className="h-[18px]" />
              <div className="flex flex-col gap-[2px]">
                {WEEKDAY.map((d, i) => (
                  <span key={`${d}-${i}`} className="h-[24px] w-4 text-center text-xs leading-[24px] text-muted">
                    {d}
                  </span>
                ))}
              </div>
            </div>

            <div className="relative flex-1">
              <div
                className="mb-0 grid h-[18px]"
                style={{ gridTemplateColumns: `repeat(${coverage.totalWeeks}, minmax(0, 1fr))` }}
              >
                {coverage.weeks.map((w, i) => {
                  const prev = i === 0 ? null : coverage.weeks[i - 1];
                  const newMonth = prev == null || weekIndex(w.start) !== weekIndex(prev.start);
                  return (
                    <span key={w.weekNumber} className="text-xs text-muted">
                      {newMonth ? shortDate(w.start) : ''}
                    </span>
                  );
                })}
              </div>

              <div className="flex gap-[3px]">
                {coverage.weeks.map((w) => (
                  <button
                    key={w.weekNumber}
                    type="button"
                    onClick={() => onWeek(w.weekNumber)}
                    aria-label={`Week ${w.weekNumber}: ${w.written ? `${w.sessions} sessions` : 'no sessions written'}`}
                    className={`flex flex-1 flex-col gap-[2px] rounded-sm p-[1px] hover:bg-white/[0.05] ${
                      w.isCurrent ? 'ring-1 ring-accent/70' : ''
                    }`}
                  >
                    {Array.from({ length: 7 }, (_, i) => {
                      const d = new Date(w.start + 'T00:00:00');
                      d.setDate(d.getDate() + i);
                      const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
                        d.getDate(),
                      ).padStart(2, '0')}`;
                      return (
                        <span
                          key={date}
                          className={`h-[24px] w-full rounded-[2px] ${cellClass(byDate.get(date), date, today)}`}
                        />
                      );
                    })}
                  </button>
                ))}
              </div>

              {coverage.uncoveredWeeks > 0 && (
                <>
                  <div
                    className="pointer-events-none absolute inset-y-0 z-[1] border-l-2 border-dashed border-caution/70"
                    style={{ left: `calc(${(boundary * 100).toFixed(2)}% - 1px)`, top: 18 }}
                    aria-hidden
                  />
                  <div
                    className="pointer-events-none absolute top-0 z-[2] -translate-x-1/2 whitespace-nowrap rounded-sm bg-surface px-1 text-xs font-medium text-caution"
                    style={{ left: `${(boundary * 100).toFixed(2)}%` }}
                  >
                    written to {coverage.lastSessionDate ? shortDate(coverage.lastSessionDate) : '—'}
                  </div>
                </>
              )}

              <div className="mt-1 flex gap-[3px]">
                {coverage.weeks.map((w) => (
                  <span
                    key={w.weekNumber}
                    className={`tnum flex-1 text-center text-xs ${
                      w.isCurrent ? 'font-semibold text-accent' : 'text-muted'
                    }`}
                  >
                    {w.weekNumber}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Mobile list */}
        <div className="md:hidden">
          <div className="flex items-center gap-3 border-b border-white/[0.07] px-1 pb-1 text-xs text-muted">
            <span className="w-6 shrink-0">Wk</span>
            <span className="w-[86px] shrink-0">Dates</span>
            <span className="flex-1">Mon → Sun</span>
            <span className="w-[52px] shrink-0 text-right">Sess.</span>
          </div>
          {coverage.weeks.map((w) => (
            <button
              key={w.weekNumber}
              type="button"
              onClick={() => onWeek(w.weekNumber)}
              className={`flex min-h-[44px] w-full items-center gap-3 border-b border-white/[0.05] px-1 py-2 text-left ${
                w.isCurrent ? 'bg-accent/[0.05]' : ''
              }`}
            >
              <span
                className={`tnum w-6 shrink-0 text-sm ${
                  w.isCurrent ? 'font-semibold text-accent' : w.written ? 'text-foreground' : 'text-muted'
                }`}
              >
                {w.weekNumber}
              </span>
              <span className="w-[86px] shrink-0 text-xs text-muted">{rangeLabel(w.start, w.end)}</span>
              <span className="flex flex-1 gap-[2px]">
                {Array.from({ length: 7 }, (_, i) => {
                  const d = new Date(w.start + 'T00:00:00');
                  d.setDate(d.getDate() + i);
                  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
                    d.getDate(),
                  ).padStart(2, '0')}`;
                  return (
                    <span
                      key={date}
                      className={`h-3.5 flex-1 rounded-[2px] ${cellClass(byDate.get(date), date, today)}`}
                    />
                  );
                })}
              </span>
              <span
                className={`tnum w-[52px] shrink-0 text-right text-sm ${
                  w.written ? 'text-foreground' : 'text-caution'
                }`}
              >
                {w.written ? w.sessions : '0'}
              </span>
            </button>
          ))}
        </div>
      </section>

        {/* The numbers the grid cannot show */}
      <div className="mt-4 hidden md:block">
        <span className="text-xs font-medium uppercase tracking-wider text-muted">Week by week</span>
        <div className="mt-2 overflow-hidden rounded-lg border border-white/[0.07]">
          <div className="grid grid-cols-[44px_120px_1fr_80px_110px] gap-2 border-b border-white/[0.07] bg-white/[0.02] px-3 py-1.5 text-xs text-muted">
            <span>Wk</span>
            <span>Dates</span>
            <span className="text-right">Sessions</span>
            <span className="text-right">Planned</span>
            <span className="text-right">State</span>
          </div>
          {coverage.weeks.map((w) => (
            <button
              key={w.weekNumber}
              type="button"
              onClick={() => onWeek(w.weekNumber)}
              className={`grid min-h-[34px] w-full grid-cols-[44px_120px_1fr_80px_110px] items-center gap-2 border-b border-white/[0.04] px-3 text-left text-sm last:border-b-0 hover:bg-white/[0.03] ${
                w.isCurrent ? 'bg-accent/[0.05]' : ''
              }`}
            >
              <span className={`tnum ${w.isCurrent ? 'font-semibold text-accent' : 'text-foreground'}`}>
                {w.weekNumber}
              </span>
              <span className="text-xs text-muted">{rangeLabel(w.start, w.end)}</span>
              <span className={`text-right ${w.written ? 'text-foreground' : 'text-muted'}`}>
                {w.written ? w.sessions : '—'}
              </span>
              <span className="tnum text-right text-muted">{w.plannedTss > 0 ? w.plannedTss : '—'}</span>
              <span
                className={`text-right text-xs ${
                  !w.written ? 'text-caution' : w.missed > 0 ? 'text-warning' : 'text-muted'
                }`}
              >
                {stateOf(w)}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/*
        The stored block/phase model (C1) keeps its editor. It used to be reachable
        only from the derived `Blocks` histogram on the old spine — a control whose
        own data source was an empty array.
      */}
      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-white/[0.06] pt-3">
        <button
          type="button"
          onClick={() => setBlocksOpen(true)}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-white/10 px-3 text-sm text-foreground hover:bg-white/[0.05]"
        >
          <Layers className="h-4 w-4" />
          Blocks &amp; phases
        </button>
        <span className="text-xs text-muted">
          Named, dated phases of the plan — the names the load strip would otherwise have to guess.
        </span>
      </div>

      <BlockEditor plan={plan} open={blocksOpen} onClose={() => setBlocksOpen(false)} />
    </>
  );
}
