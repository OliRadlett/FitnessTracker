'use client';

/**
 * Phase 2 (plans/ui-redesign-v2.md §2.1 REVIEW) — shared REVIEW time-range context.
 *
 * One range picker drives the dashboard charts together (today each chart has
 * its own window; cross-chart reasoning is impossible). Cycling / health /
 * analytics charts are NOT rewired here — a follow-up wave consumes this exact
 * API (`TimeRangeProvider` + `useTimeRange()`), so keep the shape stable:
 *
 *   { start: Date, end: Date, preset: string,
 *     setPreset(p: string): void, setCustom(s: Date, e: Date): void }
 *
 * Display only — the range changes chart query windows (`?days=` / `?weeks=`,
 * clamped to the backend caps of 365 days / 52 weeks), never computation
 * (docs/algorithms.md authoritative).
 */

import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

/** Preset label → window length in days. End is always today. */
export const TIME_RANGE_PRESETS_DAYS: Record<string, number> = {
  '30D': 30,
  '90D': 90,
  '6M': 182,
  '12M': 365,
};

export const TIME_RANGE_DEFAULT_PRESET = '90D';

export interface TimeRangeValue {
  start: Date;
  end: Date;
  preset: string;
  setPreset(p: string): void;
  setCustom(s: Date, e: Date): void;
}

const TimeRangeContext = createContext<TimeRangeValue | null>(null);

function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

function endOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(23, 59, 59, 999);
  return c;
}

/** Inclusive calendar-day span, clamped to the backend `?days=` cap (1–365). */
export function timeRangeDays(start: Date, end: Date): number {
  const raw = Math.round((startOfDay(end).getTime() - startOfDay(start).getTime()) / 86_400_000) + 1;
  if (!Number.isFinite(raw)) return 90;
  return Math.min(365, Math.max(1, raw));
}

/** Week span for `?weeks=` endpoints, clamped to the backend cap (1–52). */
export function timeRangeWeeks(start: Date, end: Date): number {
  return Math.min(52, Math.max(1, Math.round(timeRangeDays(start, end) / 7)));
}

function rangeForPreset(preset: string): { start: Date; end: Date } | null {
  const days = TIME_RANGE_PRESETS_DAYS[preset];
  if (!days) return null;
  const end = endOfDay(new Date());
  const start = startOfDay(new Date());
  start.setDate(start.getDate() - (days - 1));
  return { start, end };
}

export function TimeRangeProvider({ children }: { children: React.ReactNode }) {
  const initial = useMemo(() => rangeForPreset(TIME_RANGE_DEFAULT_PRESET)!, []);
  const [start, setStart] = useState<Date>(initial.start);
  const [end, setEnd] = useState<Date>(initial.end);
  const [preset, setPresetState] = useState<string>(TIME_RANGE_DEFAULT_PRESET);

  const setPreset = useCallback((p: string) => {
    const r = rangeForPreset(p);
    if (!r) return; // Unknown preset string — keep the current range.
    setStart(r.start);
    setEnd(r.end);
    setPresetState(p);
  }, []);

  const setCustom = useCallback((s: Date, e: Date) => {
    let from = new Date(s);
    let to = new Date(e);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return;
    if (from.getTime() > to.getTime()) [from, to] = [to, from];
    setStart(startOfDay(from));
    setEnd(endOfDay(to));
    setPresetState('custom');
  }, []);

  const value = useMemo<TimeRangeValue>(
    () => ({ start, end, preset, setPreset, setCustom }),
    [start, end, preset, setPreset, setCustom],
  );

  return <TimeRangeContext.Provider value={value}>{children}</TimeRangeContext.Provider>;
}

export function useTimeRange(): TimeRangeValue {
  const ctx = useContext(TimeRangeContext);
  if (!ctx) throw new Error('useTimeRange() must be used inside <TimeRangeProvider>');
  return ctx;
}
