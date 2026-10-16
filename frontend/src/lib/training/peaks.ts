// Derived "peaks" for the plan spine — the load strip.
//
// Weekly planned load (Σ planned_tss) from the plan's days, event markers, the
// linked event's taper window, and today are all *derived* from data we already
// have. Phase names are the exception: they are not derived, they are read from
// the stored block model (C1), and a plan with no blocks shows none — the strip
// still invents nothing.

import type { Event, TrainingPlan, TrainingPlanBlock } from '@/lib/api';
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

/** A stored block mapped onto the strip's weeks (C1). */
export interface PeakBlockBand {
  id: string;
  name: string;
  focus: string | null;
  /** First/last week index the block covers (inclusive); null when outside. */
  startIndex: number | null;
  endIndex: number | null;
  targetTssPerWeek: number | null;
}

export interface DerivedPeaks {
  weeks: PeakWeek[];
  markers: PeakMarker[];
  /** Stored blocks, in date order. Empty when the plan has none. */
  bands: PeakBlockBand[];
  /** Taper window start (linked event date − taper_days), or null. */
  taperStart: string | null;
  /** Index of the week containing today, or null if outside the plan. */
  todayIndex: number | null;
}

export function derivePeaks(
  plan: TrainingPlan | null | undefined,
  events: Event[],
  blocks: TrainingPlanBlock[] = [],
): DerivedPeaks {
  if (!plan) {
    return { weeks: [], markers: [], bands: [], taperStart: null, todayIndex: null };
  }

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

  // Blocks are *stored*, not derived: each is mapped onto the weeks it covers
  // so the strip can draw the user's own phase names.
  const bands: PeakBlockBand[] = blocks.map((b) => {
    const start = b.start_date.slice(0, 10);
    const end = b.end_date.slice(0, 10);
    const covered = weeks.filter((w) => start <= w.end && end >= w.start);
    return {
      id: b.id,
      name: b.name,
      focus: b.focus ?? null,
      startIndex: covered.length ? covered[0].weekIndex : null,
      endIndex: covered.length ? covered[covered.length - 1].weekIndex : null,
      targetTssPerWeek: b.target_tss_per_week ?? null,
    };
  });

  return {
    weeks,
    markers,
    bands,
    taperStart,
    todayIndex: todayIndex >= 0 ? todayIndex : null,
  };
}
