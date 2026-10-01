'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { getSegments, useAuthFetch } from '@/lib/api';
import type { Segment } from '@/lib/api/types';
import { usePageTitle } from '@/lib/usePageTitle';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { ErrorState } from '@/components/ui/ErrorState';
import { PageHeader } from '@/components/ui/PageHeader';
import { SectionLabel } from '@/components/ui/SectionLabel';
import { Stat } from '@/components/ui/Stat';
import { SkeletonLine } from '@/components/ui/Skeleton';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { SegmentRow, fmtKm } from '@/components/routes/SegmentRow';

/** Climbing category, steepest first — matches the Strava lettering. */
const CATEGORIES = ['HC', '1', '2', '3', '4'] as const;

const READ_FILTERS = [
  { value: 'all', label: 'All climbs' },
  { value: 'ridden', label: 'Ridden only' },
  { value: 'unridden', label: 'Not yet ridden' },
] as const;

type ReadFilter = (typeof READ_FILTERS)[number]['value'];

const ALL = 'all';

/** Within a route: steepest average gradient first, then longest. */
function compareSegments(a: Segment, b: Segment): number {
  if (b.avg_gradient_pct !== a.avg_gradient_pct) {
    return b.avg_gradient_pct - a.avg_gradient_pct;
  }
  return b.distance_m - a.distance_m;
}

interface RouteGroup {
  routeId: string;
  name: string;
  segments: Segment[];
}

function groupByRoute(segments: Segment[]): RouteGroup[] {
  const groups = new Map<string, RouteGroup>();
  for (const seg of segments) {
    let group = groups.get(seg.route_id);
    if (!group) {
      group = {
        routeId: seg.route_id,
        name: seg.route_name ?? 'Unnamed route',
        segments: [],
      };
      groups.set(seg.route_id, group);
    }
    group.segments.push(seg);
  }
  return [...groups.values()]
    .map((g) => ({ ...g, segments: [...g.segments].sort(compareSegments) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

interface ClimbGroup {
  /** `geo_cluster_id`, or a synthetic key for an unclustered segment. */
  key: string;
  /** The hill's display name: the most-ridden member's. */
  name: string;
  /** Steepest detection of the hill — the honest headline for a hill. */
  representative: Segment;
  segments: Segment[];
  /** Summed across members: one hill ridden on 3 routes is 3 passes. */
  totalPasses: number;
  routeCount: number;
}

/**
 * One row per physical hill, merged across routes.
 *
 * The whole point of `geo_cluster_id`: without it, the same hill on three routes
 * is three rows with three PRs, and the rider's real best is invisible because
 * the list is grouped by route.
 *
 * A segment with `geo_cluster_id === null` has not been clustered yet (the
 * weekly intelligence task fills it), so it gets a synthetic key of its own id
 * and stands alone. Silently merging those would invent a grouping that does not
 * exist, and silently dropping them would hide climbs.
 */
function groupByClimb(segments: Segment[]): ClimbGroup[] {
  const groups = new Map<string, ClimbGroup>();
  for (const seg of segments) {
    const key = seg.geo_cluster_id ?? seg.id;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        name: seg.name,
        representative: seg,
        segments: [],
        totalPasses: 0,
        routeCount: 0,
      };
      groups.set(key, group);
    }
    group.segments.push(seg);
    group.totalPasses += seg.times_ridden;
    group.routeCount = new Set(group.segments.map((s) => s.route_id)).size;
    // Canonical name = most-ridden member, matching the backend's
    // `canonical_climb_name`. Steepest detection as the row's representative,
    // because two detections of one hill disagree slightly on length and the
    // steeper reading is the one worth showing.
    if (seg.times_ridden > group.representative.times_ridden) {
      group.representative = seg;
      group.name = seg.name;
    }
  }
  return [...groups.values()]
    .map((g) => ({
      ...g,
      representative: g.segments.reduce((best, s) =>
        s.avg_gradient_pct > best.avg_gradient_pct ? s : best
      ),
      segments: [...g.segments].sort(compareSegments),
    }))
    .sort((a, b) => b.representative.avg_gradient_pct - a.representative.avg_gradient_pct);
}

const GROUPINGS = [
  { value: 'climb', label: 'By hill' },
  { value: 'route', label: 'By route' },
] as const;

type Grouping = (typeof GROUPINGS)[number]['value'];

export default function SegmentsPage() {
  usePageTitle('Climb Segments');
  const { authFetch, token } = useAuthFetch();
  const [routeId, setRouteId] = useState<string>(ALL);
  const [category, setCategory] = useState<string>(ALL);
  const [readFilter, setReadFilter] = useState<ReadFilter>('all');
  // Default to grouping by hill: the per-route view is the same hill repeated,
  // which is what hid the rider's real best in the first place.
  const [grouping, setGrouping] = useState<Grouping>('climb');

  const { data, isLoading, isError, refetch } = useQuery<Segment[]>({
    // One query for the whole set: the route list, the summary stats and the
    // category counts all derive from it, so filtering client-side keeps those
    // numbers consistent with what is on screen.
    queryKey: ['segments'],
    queryFn: () => getSegments(authFetch),
    enabled: !!token,
    staleTime: 300_000,
  });

  const all = useMemo(() => data ?? [], [data]);

  const routes = useMemo(() => groupByRoute(all), [all]);

  const filtered = useMemo(
    () =>
      all.filter((s) => {
        if (routeId !== ALL && s.route_id !== routeId) return false;
        if (category !== ALL && (s.climb_category ?? '').toUpperCase() !== category) {
          return false;
        }
        if (readFilter === 'ridden' && s.times_ridden === 0) return false;
        if (readFilter === 'unridden' && s.times_ridden > 0) return false;
        return true;
      }),
    [all, routeId, category, readFilter]
  );

  // Group the *filtered* set so a category/ridden filter can't leave a stale
  // group heading behind with nothing under it.
  const routeGroups = useMemo(() => groupByRoute(filtered), [filtered]);
  const climbGroups = useMemo(() => groupByClimb(filtered), [filtered]);

  const sharedHillCount = useMemo(
    () =>
      climbGroups.filter((g) => g.routeCount > 1).length,
    [climbGroups]
  );

  const stats = useMemo(() => {
    const ridden = all.filter((s) => s.times_ridden > 0);
    return {
      detected: all.length,
      riddenCount: ridden.length,
      totalPasses: all.reduce((sum, s) => sum + s.times_ridden, 0),
      totalGain: ridden.reduce((sum, s) => sum + s.elevation_gain_m, 0),
      steepest: all.reduce<Segment | null>(
        (best, s) =>
          best === null || s.avg_gradient_pct > best.avg_gradient_pct ? s : best,
        null
      ),
    };
  }, [all]);

  const activeFilterCount =
    (routeId !== ALL ? 1 : 0) +
    (category !== ALL ? 1 : 0) +
    (readFilter !== 'all' ? 1 : 0);

  const clearFilters = () => {
    setRouteId(ALL);
    setCategory(ALL);
    setReadFilter('all');
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <PageHeader
        title="Climb Segments"
        subtitle="Every sustained climb detected across your routes, with a leaderboard of your own attempts on each."
        status={
          <ErrorState
            variant="inline"
            show={isError}
            message="Could not load climb segments."
            onRetry={() => refetch()}
          />
        }
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card className="p-4">
          <Stat
            label="Climbs detected"
            value={stats.detected}
            hint={`across ${routes.length} route${routes.length === 1 ? '' : 's'}`}
          />
        </Card>
        <Card className="p-4">
          <Stat
            label="Ridden at least once"
            value={stats.riddenCount}
            hint={`${stats.totalPasses} total passes`}
          />
        </Card>
        <Card className="p-4">
          <Stat
            label="Climbing ridden"
            value={Math.round(stats.totalGain).toLocaleString()}
            unit="m"
            hint="summed over ridden climbs"
          />
        </Card>
        <Card className="p-4">
          <Stat
            label="Steepest"
            value={stats.steepest ? stats.steepest.avg_gradient_pct.toFixed(1) : '—'}
            unit="%"
            hint={stats.steepest ? fmtKm(stats.steepest.distance_m) : 'no climbs yet'}
          />
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-col sm:flex-row sm:items-center gap-3">
          <CardTitle>Filters</CardTitle>
          {activeFilterCount > 0 ? (
            <button
              type="button"
              onClick={clearFilters}
              className="text-xs text-accent hover:text-accent/80 sm:ml-auto min-h-[44px]"
            >
              Clear {activeFilterCount} filter{activeFilterCount === 1 ? '' : 's'}
            </button>
          ) : null}
        </CardHeader>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">Route</span>
            <select
              aria-label="Filter by route"
              value={routeId}
              onChange={(e) => setRouteId(e.target.value)}
              className="min-h-[44px] bg-surface border border-surface-light/50 rounded-lg px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:border-accent"
            >
              <option value={ALL}>All routes</option>
              {routes.map((g) => (
                <option key={g.routeId} value={g.routeId}>
                  {g.name} ({g.segments.length})
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">Category</span>
            <select
              aria-label="Filter by category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="min-h-[44px] bg-surface border border-surface-light/50 rounded-lg px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:border-accent"
            >
              <option value={ALL}>All categories</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  Cat {c}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div
          className="flex items-center gap-1 bg-surface rounded-lg p-1 mt-3 w-full sm:w-fit"
          role="group"
          aria-label="Filter by ridden status"
        >
          {READ_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setReadFilter(f.value)}
              className={`flex-1 sm:flex-none px-2.5 py-1 rounded-md text-xs font-medium transition-colors min-h-[44px] ${
                readFilter === f.value
                  ? 'bg-accent/20 text-accent'
                  : 'text-muted hover:text-foreground'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="mt-3 pt-3 border-t border-surface-light/50">
          <SegmentedControl
            options={[...GROUPINGS]}
            value={grouping}
            onChange={setGrouping}
            ariaLabel="Group climbs by hill or by route"
          />
          <p className="text-[11px] text-muted mt-2">
            {grouping === 'climb'
              ? sharedHillCount > 0
                ? `One row per hill. ${sharedHillCount} of these appear on more than one route — open one to see every attempt merged.`
                : 'One row per hill. Nothing is shared between routes yet; the weekly intelligence job fills that in.'
              : 'One group per route. A hill on three routes appears three times, each with its own best.'}
          </p>
        </div>
      </Card>

      <Card>
        <SectionLabel count={filtered.length}>
          {activeFilterCount === 0 ? 'All climbs' : 'Matching climbs'}
        </SectionLabel>

        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <SkeletonLine key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : all.length === 0 ? (
          <p className="text-sm text-muted">
            No climb segments yet. They are detected from a route&apos;s elevation
            profile (sustained climbs of at least ~150 m gaining ~30 m at 3% or
            more) — open a route and run <span className="text-foreground">Recompute</span>{' '}
            to detect them.
          </p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-muted">No climbs match the selected filters.</p>
        ) : grouping === 'route' ? (
          <div className="space-y-6">
            {routeGroups.map((group) => (
              <div key={group.routeId}>
                <SectionLabel count={group.segments.length}>
                  {group.name}
                </SectionLabel>
                <div className="space-y-2">
                  {group.segments.map((seg) => (
                    <SegmentRow key={seg.id} segment={seg} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {climbGroups.map((group) => {
              // Renders the most-ridden member's row, so the expanded panel and
              // the per-route leaderboard both work exactly as they do in the
              // route grouping. The summary line below carries what is merged.
              const lead = group.segments.reduce((best, s) =>
                s.times_ridden > best.times_ridden ? s : best
              );
              return (
                <div key={group.key}>
                  <SegmentRow segment={{ ...lead, geo_cluster_size: group.routeCount }} />
                  {group.routeCount > 1 ? (
                    <p className="text-[10px] text-muted px-3 pt-1 pb-2 -mt-1">
                      Also detected on {group.routeCount - 1} other route
                      {group.routeCount - 1 === 1 ? '' : 's'} ·{' '}
                      {group.totalPasses} total pass
                      {group.totalPasses === 1 ? '' : 'es'}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
