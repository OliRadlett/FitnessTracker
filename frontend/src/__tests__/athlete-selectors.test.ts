/**
 * Phase 1 (plans/ui-redesign-v2.md §1) — selector tests for `useAthleteState`.
 *
 * Presentation-only helpers: degradation is SHOWN (returned as data), never
 * averaged; load helpers read server-computed points, never recompute CTL.
 */
import { describe, expect, it } from 'vitest';
import {
  STALE_THRESHOLD_MS,
  classifyGoalTrajectories,
  deriveDegradedEngines,
  deriveLastSyncedAt,
  deriveLoadTrend,
  deriveStaleProviders,
  deriveWeekTss,
  pickActivePlan,
} from '@/lib/athlete/selectors';
import type { Connection, Goal } from '@/lib/api';

function connection(over: Partial<Connection> = {}): Connection {
  return {
    id: 'c1',
    provider: 'strava',
    provider_user_id: 'u1',
    created_at: new Date().toISOString(),
    status: 'active',
    ...over,
  };
}

function goal(over: Partial<Goal> = {}): Goal {
  return {
    id: 'g1',
    user_id: 'u1',
    metric: 'ftp',
    target_value: 250,
    status: 'active',
    target_date: '2026-12-31',
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    ...over,
  };
}

describe('deriveStaleProviders', () => {
  const NOW = new Date('2026-10-09T12:00:00Z').getTime();
  const fresh = new Date(NOW - 60 * 60 * 1000).toISOString();
  const stale = new Date(NOW - STALE_THRESHOLD_MS - 1000).toISOString();

  it('flags needs_reauth regardless of sync age', () => {
    const out = deriveStaleProviders(
      [connection({ provider: 'whoop', status: 'needs_reauth', last_synced_at: fresh })],
      NOW,
    );
    expect(out).toHaveLength(1);
  });

  it('flags stale-but-valid connections and keeps fresh ones quiet', () => {
    const out = deriveStaleProviders(
      [
        connection({ provider: 'strava', last_synced_at: stale }),
        connection({ provider: 'wahoo', last_synced_at: fresh }),
      ],
      NOW,
    );
    expect(out.map((c) => c.provider)).toEqual(['strava']);
  });

  it('does not drop never-synced connections from the input, but does not flag them stale', () => {
    // "never" is surfaced by the caller as lastSyncedAt=null, not by dropping.
    const out = deriveStaleProviders([connection({ last_synced_at: null })], NOW);
    expect(out).toHaveLength(0);
  });

  it('returns empty for empty input', () => {
    expect(deriveStaleProviders([], NOW)).toEqual([]);
    expect(deriveStaleProviders(null, NOW)).toEqual([]);
  });
});

describe('deriveLastSyncedAt', () => {
  it('picks the freshest timestamp', () => {
    expect(
      deriveLastSyncedAt([
        connection({ last_synced_at: '2026-10-01T00:00:00Z' }),
        connection({ last_synced_at: '2026-10-08T00:00:00Z' }),
        connection({ last_synced_at: null }),
      ]),
    ).toBe('2026-10-08T00:00:00Z');
  });

  it('returns null when nothing ever synced', () => {
    expect(deriveLastSyncedAt([connection({ last_synced_at: null })])).toBeNull();
    expect(deriveLastSyncedAt(null)).toBeNull();
  });
});

describe('deriveDegradedEngines', () => {
  it('returns only the silent rows — silence is a finding, not unanimity', () => {
    const consensus = [
      { engine: 'rest_day_suggestion', stance: 'train', available: true },
      { engine: 'cross_domain', available: false, reason: 'not run yet' },
      { engine: 'projection', available: false, reason: 'no active plan' },
    ];
    const out = deriveDegradedEngines(consensus);
    expect(out.map((c) => c.engine)).toEqual(['cross_domain', 'projection']);
  });
});

describe('classifyGoalTrajectories', () => {
  const projections = new Map([
    ['g1', { badge: 'On Track', projection: { projected_date: '2026-11-01', days_remaining: 23 } }],
    ['g2', { badge: 'At Risk', projection: { projected_date: '2027-02-01', days_remaining: 115 } }],
    ['g3', { badge: 'Unlikely', projection: null }],
    ['g4', { badge: 'Not enough data', projection: null }],
  ]);

  it('splits On Track vs At Risk/Unlikely and never force-ranks the rest', () => {
    const goals = [
      goal({ id: 'g1' }),
      goal({ id: 'g2' }),
      goal({ id: 'g3' }),
      goal({ id: 'g4' }),
      goal({ id: 'g5' }),
      goal({ id: 'g6', status: 'achieved' }),
      goal({ id: 'g7', target_date: null }),
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { atRisk, onTrack, unclassified } = classifyGoalTrajectories(goals, projections as any);
    expect(onTrack.map((t) => t.goal.id)).toEqual(['g1']);
    expect(atRisk.map((t) => t.goal.id)).toEqual(['g2', 'g3']);
    // g4 (not enough data) + g5 (no projection) stay unclassified;
    // g6 (achieved) + g7 (no target date) are out of scope entirely.
    expect(unclassified.map((g) => g.id)).toEqual(['g4', 'g5']);
    expect(onTrack[0].projectedDate).toBe('2026-11-01');
    expect(onTrack[0].daysRemaining).toBe(23);
  });
});

describe('deriveLoadTrend', () => {
  const points = Array.from({ length: 10 }, (_, i) => ({
    date: `2026-09-${String(i + 1).padStart(2, '0')}`,
    tss: 50,
    ctl: 20,
    atl: 10,
    tsb: i - 9, // …, -2, -1, 0 → last is 0, 7d-ago is -7
  }));

  it('compares two server-computed TSB points (display delta, not a recompute)', () => {
    const { delta, direction } = deriveLoadTrend(points);
    expect(delta).toBeCloseTo(7);
    expect(direction).toBe('up');
  });

  it('reports flat for small moves and null for missing data', () => {
    const flat = points.map((p) => ({ ...p, tsb: 5 }));
    expect(deriveLoadTrend(flat).direction).toBe('flat');
    expect(deriveLoadTrend([])).toEqual({ delta: null, direction: null });
    expect(deriveLoadTrend(null)).toEqual({ delta: null, direction: null });
  });
});

describe('deriveWeekTss', () => {
  it('sums the trailing 7 days', () => {
    const points = Array.from({ length: 10 }, (_, i) => ({
      date: `2026-09-${String(i + 1).padStart(2, '0')}`,
      tss: 10,
      ctl: 20,
      atl: 10,
      tsb: 0,
    }));
    expect(deriveWeekTss(points)).toBe(70);
  });

  it('returns null when any tail point lacks TSS rather than summing a partial week', () => {
    const points = Array.from({ length: 7 }, () => ({
      date: '2026-09-01',
      tss: 10,
      ctl: 20,
      atl: 10,
      tsb: 0,
    }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (points[3] as any).tss = null;
    expect(deriveWeekTss(points)).toBeNull();
  });
});

describe('pickActivePlan', () => {
  const plans = [
    { id: 'past', name: 'Past', start_date: '2026-01-01', end_date: '2026-02-01' },
    { id: 'now', name: 'Now', start_date: '2026-10-01', end_date: '2026-11-01' },
  ];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const summaries = plans as any;

  it('picks the plan covering today', () => {
    expect(pickActivePlan(summaries, '2026-10-09')?.id).toBe('now');
  });

  it('returns null with no in-range plan — never a fallback guess', () => {
    expect(pickActivePlan(summaries, '2026-05-01')).toBeNull();
    expect(pickActivePlan([], '2026-10-09')).toBeNull();
    expect(pickActivePlan(null)).toBeNull();
  });
});
