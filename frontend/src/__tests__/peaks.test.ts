import { describe, expect, it } from 'vitest';

import type { Event, TrainingPlan } from '@/lib/api';
import { addDays, mondayOf, toDateStr } from '@/lib/training/week';
import { derivePeaks } from '@/lib/training/peaks';

function plan(over: Partial<TrainingPlan> = {}): TrainingPlan {
  return {
    id: 'p1',
    user_id: 'u1',
    name: 'Build',
    start_date: '2026-08-03', // Monday
    end_date: '2026-08-16',
    plan_type: 'build',
    status: 'active',
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
    days: [],
    ...over,
  };
}

function event(over: Partial<Event> = {}): Event {
  return {
    id: 'e1',
    user_id: 'u1',
    name: 'Autumn 100',
    event_date: '2026-08-16',
    event_type: 'race',
    taper_days: 7,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
    days_until: 5,
    is_in_taper: false,
    ...over,
  };
}

describe('derivePeaks', () => {
  it('returns empty for no plan', () => {
    const out = derivePeaks(null, []);
    expect(out.weeks).toEqual([]);
    expect(out.markers).toEqual([]);
    expect(out.taperStart).toBeNull();
  });

  it('sums planned TSS into the correct week', () => {
    const p = plan({
      days: [
        { id: 'd1', plan_id: 'p1', day_date: '2026-08-05', sport: 'cycle', planned_type: 'hard', planned_tss: 100, completed: false },
        { id: 'd2', plan_id: 'p1', day_date: '2026-08-12', sport: 'cycle', planned_type: 'hard', planned_tss: 150, completed: false },
      ],
    });
    const { weeks } = derivePeaks(p, []);
    expect(weeks).toHaveLength(2);
    expect(weeks[0]).toMatchObject({ weekIndex: 0, start: '2026-08-03', end: '2026-08-09', totalTss: 100 });
    expect(weeks[1]).toMatchObject({ weekIndex: 1, start: '2026-08-10', end: '2026-08-16', totalTss: 150 });
  });

  it('marks events inside the plan window and ignores those outside', () => {
    const { markers } = derivePeaks(plan(), [event(), event({ id: 'e2', event_date: '2026-09-30' })]);
    const eventMarkers = markers.filter((m) => m.kind === 'event');
    expect(eventMarkers).toHaveLength(1);
    expect(eventMarkers[0]).toMatchObject({ date: '2026-08-16', label: 'Autumn 100', eventType: 'race' });
  });

  it('derives the taper window from the linked event', () => {
    const p = plan({ event_id: 'e1' });
    expect(derivePeaks(p, [event()]).taperStart).toBe('2026-08-09'); // 2026-08-16 − 7 days
    expect(derivePeaks(plan(), [event()]).taperStart).toBeNull(); // not linked
  });

  it('locates today within the plan (and null when outside)', () => {
    const today = toDateStr(new Date());
    const start = mondayOf(today);
    const spanning = plan({ start_date: start, end_date: addDays(start, 13) });
    const { todayIndex, markers } = derivePeaks(spanning, []);
    expect(todayIndex).toBe(0);
    expect(markers.some((m) => m.kind === 'today')).toBe(true);

    // The fixed 2026-08 plan is outside today (2026-10+).
    expect(derivePeaks(plan(), []).todayIndex).toBeNull();
  });
});
