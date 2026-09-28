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

export default function SegmentsPage() {
  usePageTitle('Climb Segments');
  const { authFetch, token } = useAuthFetch();
  const [routeId, setRouteId] = useState<string>(ALL);
  const [category, setCategory] = useState<string>(ALL);
  const [readFilter, setReadFilter] = useState<ReadFilter>('all');

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
  const groups = useMemo(() => groupByRoute(filtered), [filtered]);

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
        ) : (
          <div className="space-y-6">
            {groups.map((group) => (
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
        )}
      </Card>
    </div>
  );
}
