// Derived "peaks" for the plan spine — the load strip.
//
// There is no stored block/phase model, so this is a *derived* read-out from
// data we already have: weekly planned load (Σ planned_tss) from the plan's
// days, event markers, the linked event's taper window, and today. It
// deliberately invents no phase names (Base/Build/Peak) — those arrive with a
// real block model (redesign plan §11 C1).

import type { Event, TrainingPlan } from '@/lib/api';
import { addDays, getTotalWeeks, getWeek1Start, toDateStr } from './week';

export interface PeakWeek {
  weekIndex: number;
  start: string;
  end: string;
  totalTss: number;
}

export interface PeakMarker {
  date: string;
  kind: 'event' | 'today';
  label: string;
  eventType?: string;
}

export interface DerivedPeaks {
  weeks: PeakWeek[];
  markers: PeakMarker[];
  /** Taper window start (linked event date − taper_days), or null. */
  taperStart: string | null;
  /** Index of the week containing today, or null if outside the plan. */
  todayIndex: number | null;
}

export function derivePeaks(
  plan: TrainingPlan | null | undefined,
  events: Event[],
): DerivedPeaks {
  if (!plan) return { weeks: [], markers: [], taperStart: null, todayIndex: null };

  const totalWeeks = getTotalWeeks(plan.start_date, plan.end_date);
  const week1 = getWeek1Start(plan.start_date);
  const days = plan.days ?? [];

  const weeks: PeakWeek[] = Array.from({ length: totalWeeks }, (_, wi) => {
    const start = addDays(week1, wi * 7);
    const end = addDays(start, 6);
    const totalTss = Math.round(
      days
        .filter((d) => {
          const dd = d.day_date.slice(0, 10);
          return dd >= start && dd <= end;
        })
        .reduce((s, d) => s + (d.planned_tss || 0), 0),
    );
    return { weekIndex: wi, start, end, totalTss };
  });

  const today = toDateStr(new Date());
  const markers: PeakMarker[] = [];
  for (const e of events) {
    const date = e.event_date.slice(0, 10);
    if (date < plan.start_date || date > plan.end_date) continue;
    markers.push({ date, kind: 'event', label: e.name, eventType: e.event_type });
  }
  const todayIndex = weeks.findIndex((w) => today >= w.start && today <= w.end);
  if (todayIndex >= 0) markers.push({ date: today, kind: 'today', label: 'Today' });

  const linked = events.find((e) => e.id === plan.event_id);
  const taperStart = linked
    ? addDays(linked.event_date.slice(0, 10), -linked.taper_days)
    : null;

  return { weeks, markers, taperStart, todayIndex: todayIndex >= 0 ? todayIndex : null };
}
