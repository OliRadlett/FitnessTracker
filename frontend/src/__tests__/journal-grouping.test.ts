import { describe, it, expect } from 'vitest';
import type { Activity } from '@/lib/api';
import {
  buildListParams,
  buildSummaryParams,
  groupByWeek,
  journalStartDate,
} from '@/lib/journal';

function act(partial: Partial<Activity>): Activity {
  return {
    id: partial.id ?? 'id',
    user_id: 'u',
    source: 'strava',
    sport_type: partial.sport_type ?? 'cycling',
    name: partial.name ?? 'Ride',
    start_date: partial.start_date ?? '2026-10-14T08:00:00',
    synced_at: '2026-10-14T08:00:00',
    created_at: '2026-10-14T08:00:00',
    updated_at: '2026-10-14T08:00:00',
    ...partial,
  } as Activity;
}

// Wednesday 14 Oct 2026 — its Monday-based week starts 2026-10-12.
const NOW = new Date('2026-10-14T12:00:00');

describe('groupByWeek', () => {
  const activities: Activity[] = [
    act({ id: 'a1', sport_type: 'cycling', start_date: '2026-10-14T08:00:00', tss: 100, distance_meters: 20000, duration_seconds: 3600 }),
    act({ id: 'a2', sport_type: 'weighttraining', start_date: '2026-10-14T18:00:00', tss: 30, distance_meters: null as unknown as undefined, duration_seconds: 1800 }),
    act({ id: 'a3', sport_type: 'running', start_date: '2026-10-12T07:00:00', tss: 50, distance_meters: 5000, duration_seconds: 1500 }),
    act({ id: 'a4', sport_type: 'cycling', start_date: '2026-10-05T09:00:00', tss: 80, distance_meters: 30000, duration_seconds: 4000 }),
  ];

  it('groups into Monday-based weeks, newest first', () => {
    const weeks = groupByWeek(activities, NOW);
    expect(weeks.map((w) => w.weekStart)).toEqual(['2026-10-12', '2026-10-05']);
  });

  it('orders days within a week newest first', () => {
    const weeks = groupByWeek(activities, NOW);
    expect(weeks[0].days.map((d) => d.date)).toEqual(['2026-10-14', '2026-10-12']);
  });

  it('computes week totals, excluding strength from distance', () => {
    const weeks = groupByWeek(activities, NOW);
    expect(weeks[0].count).toBe(3);
    expect(weeks[0].tss).toBe(180);
    expect(weeks[0].distanceMeters).toBe(25000); // 20000 cycling + 0 strength + 5000 run
    expect(weeks[0].durationSeconds).toBe(6900);
  });

  it('computes day totals', () => {
    const weeks = groupByWeek(activities, NOW);
    const wed = weeks[0].days[0];
    expect(wed.activities).toHaveLength(2);
    expect(wed.tss).toBe(130);
    expect(wed.distanceMeters).toBe(20000);
    expect(wed.durationSeconds).toBe(5400);
  });

  it('builds a Monday-first weekly rhythm from TSS', () => {
    const weeks = groupByWeek(activities, NOW);
    expect(weeks[0].rhythm).toEqual([50, 0, 130, 0, 0, 0, 0]);
    expect(weeks[1].rhythm).toEqual([80, 0, 0, 0, 0, 0, 0]);
  });

  it('labels today and yesterday', () => {
    const weeks = groupByWeek(
      [
        act({ id: 't', start_date: '2026-10-14T08:00:00' }),
        act({ id: 'y', start_date: '2026-10-13T08:00:00' }),
      ],
      NOW,
    );
    expect(weeks[0].days[0].label).toBe('Today');
    expect(weeks[0].days[1].label).toBe('Yesterday');
  });

  it('returns nothing for an empty list', () => {
    expect(groupByWeek([], NOW)).toEqual([]);
  });
});

describe('journalStartDate', () => {
  it('subtracts the look-back window', () => {
    expect(journalStartDate(7, NOW)).toBe('2026-10-07');
    expect(journalStartDate(30, NOW)).toBe('2026-09-14');
  });

  it('treats 0 (all time) as a wide window', () => {
    const allTime = journalStartDate(0, NOW);
    expect(allTime < '2020-01-01').toBe(true);
  });
});

describe('query builders', () => {
  it('builds list params with sort, paging and filters', () => {
    const params = buildListParams(
      { days: 30, sport: 'cycling', q: '  alps ', sort: 'distance' },
      50,
      100,
      NOW,
    );
    expect(params.get('sort_by')).toBe('distance');
    expect(params.get('sort_order')).toBe('desc');
    expect(params.get('sport_type')).toBe('cycling');
    expect(params.get('q')).toBe('alps');
    expect(params.get('limit')).toBe('50');
    expect(params.get('offset')).toBe('100');
    expect(params.get('start_date_after')).toBe('2026-09-14');
  });

  it('omits sport and q when empty', () => {
    const params = buildListParams({ days: 30, sport: '', q: '', sort: 'date' }, 50, 0);
    expect(params.has('sport_type')).toBe(false);
    expect(params.has('q')).toBe(false);
    expect(params.get('sort_by')).toBe('start_date');
  });

  it('builds summary params without sort or paging', () => {
    const params = buildSummaryParams({ days: 30, sport: 'running', q: 'park', sort: 'tss' });
    expect(params.get('sport_type')).toBe('running');
    expect(params.get('q')).toBe('park');
    expect(params.has('sort_by')).toBe(false);
    expect(params.has('limit')).toBe(false);
    expect(params.has('offset')).toBe(false);
  });
});
