'use client';

/**
 * V2: Week navigation for the dashboard — replaces TimeRangePicker.
 *
 * Prev/next week buttons + year dropdown (for Month/Year views).
 * Week math mirrors the backend exactly (Monday-aligned).
 *
 * Uses useTimeRange() so charts stay in sync — no new context needed.
 */

import React from 'react';
import { getActiveLocale } from '@/lib/utils';
import { mondayOfOffset } from './PeriodNav';

const NAV_BTN =
  'min-h-[44px] min-w-[44px] px-3 py-2 text-sm font-medium rounded-lg transition-colors ' +
  'bg-surface-light/50 text-foreground hover:bg-surface-light disabled:opacity-40 disabled:cursor-not-allowed';

const YEARS = (() => {
  const now = new Date().getFullYear();
  return Array.from({ length: 6 }, (_, i) => now - 2 + i);
})();

export interface WeekNavProps {
  weeksBack: number;
  onChange: (weeksBack: number) => void;
  /** Year dropdown only renders when this is provided (Month tab). */
  selectedYear?: number;
  onYearChange?: (year: number) => void;
}

function fmtDay(d: Date): string {
  return d.toLocaleDateString(getActiveLocale(), { month: 'short', day: 'numeric' });
}

export function WeekNav({
  weeksBack,
  onChange,
  selectedYear,
  onYearChange,
}: WeekNavProps) {
  const monday = mondayOfOffset(weeksBack);
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);

  const relative =
    weeksBack === 0 ? 'This week' :
    weeksBack === 1 ? 'Last week' :
    `${weeksBack} weeks ago`;

  return (
    <div className="flex items-center gap-2" role="group" aria-label="Week navigation">
      <button
        type="button"
        onClick={() => onChange(Math.min(weeksBack + 1, 12))}
        disabled={weeksBack >= 12}
        className={NAV_BTN}
        aria-label="Previous week"
      >
        ←
      </button>
      <div className="text-center min-w-[12rem]">
        <p className="text-sm font-medium text-foreground tabular-nums">
          {fmtDay(monday)} – {fmtDay(sunday)}
        </p>
        <p className="text-xs text-muted">{relative}</p>
      </div>
      <button
        type="button"
        onClick={() => onChange(Math.max(weeksBack - 1, 0))}
        disabled={weeksBack <= 0}
        className={NAV_BTN}
        aria-label="Next week"
      >
        →
      </button>
      {selectedYear != null && onYearChange && (
        <select
          value={selectedYear}
          onChange={(e) => onYearChange(Number(e.target.value))}
          className="min-h-[44px] text-sm rounded-lg bg-surface border border-surface/20 text-foreground px-2 tabular-nums"
          aria-label="Select year"
        >
          {YEARS.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
