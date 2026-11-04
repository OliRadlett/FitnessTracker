'use client';

import React from 'react';

import type { WeekSummary } from '@/lib/training/coverage';

/**
 * One cell per plan week: the plan's *written extent* against its claimed span.
 *
 * This is the object the old page never had. It printed `47/49 · 96%` — progress
 * measured on authored days — so a plan that ran dry nineteen days ago read as
 * nearly finished. The rail shows the same fact as a shape: filled where sessions
 * exist, hollow afterwards.
 *
 * Below `md` it is a picture, not a control: a 17 px cell cannot be tapped, and
 * week navigation lives in the chevrons and the Plan list.
 */
export function CoverageRail({
  weeks,
  onSelect,
  interactive = true,
  size = 'sm',
}: {
  weeks: WeekSummary[];
  onSelect?: (weekNumber: number) => void;
  interactive?: boolean;
  size?: 'sm' | 'md';
}) {
  const height = size === 'sm' ? 'h-7' : 'h-9';
  const written = weeks.filter((w) => w.written).length;

  const cellClass = (w: WeekSummary) =>
    `flex-1 rounded-[3px] ${
      w.written ? (w.isPast ? 'bg-accent/45' : 'bg-accent/80') : 'border border-dashed border-white/15 bg-transparent'
    } ${w.isCurrent ? 'ring-2 ring-accent ring-offset-2 ring-offset-background' : ''}`;

  const title = (w: WeekSummary) =>
    `Week ${w.weekNumber} · ${w.written ? `${w.sessions} sessions` : 'no sessions'}`;

  return (
    <div
      className="flex items-stretch gap-[3px]"
      role={interactive ? 'group' : 'img'}
      aria-label={
        interactive
          ? 'Plan coverage by week'
          : `Plan coverage: ${written} of ${weeks.length} weeks written`
      }
    >
      {weeks.map((w) =>
        interactive ? (
          <button
            key={w.weekNumber}
            type="button"
            onClick={() => onSelect?.(w.weekNumber)}
            title={title(w)}
            aria-label={`Week ${w.weekNumber}, ${w.written ? `${w.sessions} sessions written` : 'not written'}`}
            className={`${height} ${cellClass(w)}`}
          />
        ) : (
          <span key={w.weekNumber} title={title(w)} className={`${height} ${cellClass(w)}`} />
        ),
      )}
    </div>
  );
}
