'use client';

/**
 * Phase 2 (plans/ui-redesign-v2.md §2.1 + Walkthrough: dashboard survives with
 * previous-period navigation) — prev/next week + prev/next month navigation.
 *
 * Week math mirrors the backend exactly (`_week_bounds` in
 * `backend/app/api/dashboard/weekly.py` and `__init__.py`:
 * `monday = today − weekday(today) − 7·offset`, Monday-aligned) and the
 * training WeeklyView's `mondayOf` (`(getDay() + 6) % 7` offset). The 3-line
 * math is duplicated here on purpose — dashboard must not import training
 * cross-mode internals.
 */

import React from 'react';
import { getActiveLocale } from '@/lib/utils';

export function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Monday (local midnight) of the week `offsetWeeks` back. 0 = current week. */
export function mondayOfOffset(offsetWeeks: number, from: Date = new Date()): Date {
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - offsetWeeks * 7);
  return d;
}

export function addDaysToDate(d: Date, n: number): Date {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}

function fmtDay(d: Date): string {
  return d.toLocaleDateString(getActiveLocale(), { month: 'short', day: 'numeric' });
}

/** 'YYYY-MM' → 'September 2026'. */
export function formatMonthKey(monthKey: string): string {
  const d = new Date(`${monthKey}-01T00:00:00`);
  if (Number.isNaN(d.getTime())) return monthKey;
  return d.toLocaleDateString(getActiveLocale(), { month: 'long', year: 'numeric' });
}

const NAV_BTN =
  'min-h-[44px] min-w-[44px] px-3 py-2 text-sm font-medium rounded-lg transition-colors ' +
  'bg-surface-light/50 text-foreground hover:bg-surface-light disabled:opacity-40 disabled:cursor-not-allowed';

// ─── Week ────────────────────────────────────────────────────────────────────

export function WeekNavigator({
  weeksBack,
  onChange,
  maxBack = 12,
}: {
  /** 0 = current week, 1 = last week … (matches `?weeks_back=`). */
  weeksBack: number;
  onChange: (weeksBack: number) => void;
  /** Backend caps `weeks_back` at 12 — the Prev button stops there. */
  maxBack?: number;
}) {
  const monday = mondayOfOffset(weeksBack);
  const sunday = addDaysToDate(monday, 6);
  const relative = weeksBack === 0 ? 'This week' : weeksBack === 1 ? 'Last week' : `${weeksBack} weeks ago`;
  return (
    <div className="flex items-center gap-2" role="group" aria-label="Week navigation">
      <button
        type="button"
        onClick={() => onChange(Math.min(weeksBack + 1, maxBack))}
        disabled={weeksBack >= maxBack}
        className={NAV_BTN}
        aria-label="Previous week"
      >
        ←
      </button>
      <div className="text-center min-w-[12rem]">
        <p className="text-sm font-medium text-foreground tabular-nums">
          Week of {fmtDay(monday)} – {fmtDay(sunday)}
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
    </div>
  );
}

// ─── Month ───────────────────────────────────────────────────────────────────

export function MonthNavigator({
  months,
  focusedIndex,
  onChange,
}: {
  /** 'YYYY-MM' keys, newest first (the `monthly-summary` endpoint order). */
  months: string[];
  focusedIndex: number;
  onChange: (index: number) => void;
}) {
  const empty = months.length === 0;
  const idx = empty ? 0 : Math.min(Math.max(focusedIndex, 0), months.length - 1);
  const key = empty ? null : months[idx];
  return (
    <div className="flex items-center gap-2" role="group" aria-label="Month navigation">
      <button
        type="button"
        onClick={() => onChange(Math.min(idx + 1, months.length - 1))}
        disabled={empty || idx >= months.length - 1}
        className={NAV_BTN}
        aria-label="Previous month"
      >
        ←
      </button>
      <div className="text-center min-w-[12rem]">
        <p className="text-sm font-medium text-foreground tabular-nums">
          {key ? formatMonthKey(key) : 'No monthly data'}
        </p>
        {!empty && (
          <p className="text-xs text-muted tabular-nums">
            {idx + 1} of {months.length}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={() => onChange(Math.max(idx - 1, 0))}
        disabled={empty || idx <= 0}
        className={NAV_BTN}
        aria-label="Next month"
      >
        →
      </button>
    </div>
  );
}
