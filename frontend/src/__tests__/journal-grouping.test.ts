import { describe, it, expect } from 'vitest';
import type { Activity } from '@/lib/api';
import {
  buildListParams,
  buildSummaryParams,
  describeActivity,
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
    expect(wed.rows).toHaveLength(2);
    expect(wed.tss).toBe(130);
    expect(wed.distanceMeters).toBe(20000);
    expect(wed.durationSeconds).toBe(5400);
  });

  it('builds a Monday-first week shape from session durations', () => {
    const weeks = groupByWeek(activities, NOW);
    expect(weeks[0].strip).toHaveLength(7);
    // Monday 12th carries the run; Wednesday 14th carries the ride + lift.
    expect(weeks[0].strip[0].seconds).toBe(1500);
    expect(weeks[0].strip[2].seconds).toBe(5400);
    expect(weeks[0].strip[2].sessions).toBe(2);
    expect(weeks[0].strip[1].sessions).toBe(0);
  });

  it('groups by the local calendar date, not the UTC slice', () => {
    // A late-evening UTC timestamp is the next day in a positive-offset zone.
    // The key must follow the user's calendar, which is what the adjacent
    // labels already use.
    const iso = '2026-10-14T23:30:00Z';
    const local = new Date(iso);
    const expected = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(
      local.getDate(),
    ).padStart(2, '0')}`;

    const weeks = groupByWeek([act({ start_date: iso })], new Date('2026-10-20T12:00:00'));

    expect(weeks[0].days[0].date).toBe(expected);
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

describe('describeActivity', () => {
  it('names a ride after its route when the name is usable', () => {
    const row = describeActivity(act({ route_name: 'Geneva Vineyard Route', name: 'Cycling' }));
    expect(row.title).toBe('Geneva Vineyard Route');
  });

  it('ignores a route that merely repeats the activity title', () => {
    // 16 of 22 named routes in production are literally "Cycling".
    const row = describeActivity(act({ route_name: 'Cycling', name: 'Cycling', ride_type: 'tempo' }));
    expect(row.title).toBe('Tempo ride');
  });

  it('falls back to the ride type, then to "Ride"', () => {
    expect(describeActivity(act({ ride_type: 'threshold' })).title).toBe('Threshold ride');
    expect(describeActivity(act({})).title).toBe('Ride');
  });

  it('names a lift after the exercise it trained, not the activity', () => {
    const row = describeActivity(
      act({
        sport_type: 'strength',
        name: 'Evening Weight Training',
        linked_lifting_session: {
          id: 's1',
          session_date: '2026-10-14',
          focus: 'Push',
          set_count: 16,
          total_volume_kg: 5326,
          top_exercise: 'Bench Press',
          top_weights: [90, 90, 70],
        },
      }),
    );

    expect(row.title).toBe('Bench Press');
    expect(row.meta).toContain('Push day');
    expect(row.secondary).toContain('5,326 kg');
    expect(row.glyph).toEqual({ kind: 'lift', weights: [90, 90, 70] });
  });

  it('says so when a lift has no set log', () => {
    const row = describeActivity(
      act({ sport_type: 'strength', name: 'Evening Weight Training', average_heartrate: 113 }),
    );

    expect(row.title).toBe('Weight training');
    expect(row.meta).toContain('no set log');
    expect(row.secondary).toBe('113 bpm avg');
  });

  it('keeps a name the user actually gave the session', () => {
    // Strava lets a ride be renamed, and a sportive arrives named. Discarding
    // it loses information the provider never had — the assertion the E2E
    // deep-link test caught.
    const row = describeActivity(
      act({ name: 'Morning Ride — Surrey Hills', route_name: 'Surrey Hills Loop' }),
    );
    expect(row.title).toBe('Morning Ride — Surrey Hills');
  });

  it('keeps a run out of the lifting layout', () => {
    // The two-way branch titled a run "Weight training" and claimed it had no
    // set log; the dev database has no runs, so this is the only coverage.
    const row = describeActivity(
      act({
        sport_type: 'running',
        name: 'Morning Run',
        distance_meters: 12400,
        duration_seconds: 3600,
        average_heartrate: 148,
      }),
    );

    expect(row.kind).toBe('other');
    // "Morning Run" is provider boilerplate, exactly as "Cycling" is.
    expect(row.title).toBe('Running');
    expect(row.secondary).toBe('12.4 km · 148 bpm');
    expect(row.meta).not.toContain('no set log');
  });

  it('keeps a named run titled as the user named it', () => {
    const row = describeActivity(
      act({ sport_type: 'running', name: 'Parkrun PB attempt', distance_meters: 5000 }),
    );
    expect(row.title).toBe('Parkrun PB attempt');
  });

  it('falls back to the sport label when a run has no name', () => {
    const row = describeActivity(act({ sport_type: 'running', name: '  ' }));
    expect(row.title).toBe('Running');
  });

  it('shows ride metrics for a ride and lift metrics for a lift', () => {
    const ride = describeActivity(act({ distance_meters: 55632, duration_seconds: 11552, tss: 115 }));
    expect(ride.secondary).toBe('55.6 km · 115 TSS');

    const lift = describeActivity(
      act({
        sport_type: 'strength',
        duration_seconds: 4200,
        linked_lifting_session: {
          id: 's1',
          session_date: '2026-10-14',
          set_count: 12,
          total_volume_kg: 4000,
          top_exercise: 'Squat',
          top_weights: [120],
        },
      }),
    );
    expect(lift.secondary).toBe('4,000 kg · 12 sets');
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

  it('sends a sport family as sport_group, because provider strings vary', () => {
    const params = buildListParams({ days: 30, sport: 'lift', q: '', sort: 'date' }, 50, 0, NOW);
    expect(params.get('sport_group')).toBe('lift');
    expect(params.has('sport_type')).toBe(false);
  });

  it('omits sport and q when empty', () => {
    const params = buildListParams({ days: 30, sport: '', q: '', sort: 'date' }, 50, 0);
    expect(params.has('sport_type')).toBe(false);
    expect(params.has('sport_group')).toBe(false);
    expect(params.has('q')).toBe(false);
    expect(params.get('sort_by')).toBe('start_date');
  });

  it('builds summary params without sort or paging', () => {
    const params = buildSummaryParams({ days: 30, sport: 'lift', q: 'park', sort: 'tss' });
    expect(params.get('sport_group')).toBe('lift');
    expect(params.get('q')).toBe('park');
    expect(params.has('sort_by')).toBe(false);
    expect(params.has('limit')).toBe(false);
    expect(params.has('offset')).toBe(false);
  });
});
