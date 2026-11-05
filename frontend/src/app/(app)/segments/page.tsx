'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, Mountain, Search } from 'lucide-react';

import { getSegmentGroups, useAuthFetch } from '@/lib/api';
import type { SegmentGroup } from '@/lib/api/types';
import { usePageTitle } from '@/lib/usePageTitle';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { PageHeader } from '@/components/ui/PageHeader';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { SkeletonLine } from '@/components/ui/Skeleton';
import { ClimbProfile } from '@/components/segments/ClimbProfile';

const CAT_STYLES: Record<string, string> = {
  HC: 'border-red-500/30 bg-red-500/15 text-red-300',
  '1': 'border-orange-500/30 bg-orange-500/15 text-orange-300',
  '2': 'border-yellow-500/30 bg-yellow-500/15 text-yellow-300',
  '3': 'border-sky-500/30 bg-sky-500/15 text-sky-300',
  '4': 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300',
};

function CatChip({ category }: { category: string | null }) {
  if (!category) return null;
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded border px-1.5 py-0.5 text-xs font-bold ${
        CAT_STYLES[category.toUpperCase()] ?? CAT_STYLES['4']
      }`}
    >
      Cat {category.toUpperCase()}
    </span>
  );
}

function fmtTime(seconds: number | null | undefined): string {
  if (seconds == null) return '—';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function fmtKm(m: number): string {
  return `${(m / 1000).toFixed(m < 10000 ? 2 : 1)} km`;
}

function fmtDate(iso: string | null): string {
  return iso
    ? new Date(iso).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
      })
    : '—';
}

type Tab = 'ridden' | 'to_ride' | 'all';
type SortKey =
  | 'attempts'
  | 'recent'
  | 'hardest'
  | 'longest'
  | 'steepest'
  | 'name';

const SORTERS: Record<SortKey, (a: SegmentGroup, b: SegmentGroup) => number> = {
  attempts: (a, b) =>
    b.attempts - a.attempts || (b.difficulty ?? 0) - (a.difficulty ?? 0),
  recent: (a, b) => (b.last_ridden ?? '').localeCompare(a.last_ridden ?? ''),
  hardest: (a, b) => (b.difficulty ?? 0) - (a.difficulty ?? 0),
  longest: (a, b) => b.distance_m - a.distance_m,
  steepest: (a, b) => b.avg_gradient_pct - a.avg_gradient_pct,
  name: (a, b) => a.name.localeCompare(b.name),
};

const SORTS: { value: SortKey; label: string }[] = [
  { value: 'attempts', label: 'Most attempts' },
  { value: 'recent', label: 'Most recent' },
  { value: 'hardest', label: 'Hardest' },
  { value: 'longest', label: 'Longest' },
  { value: 'steepest', label: 'Steepest' },
  { value: 'name', label: 'Name' },
];

function ClimbCard({ climb }: { climb: SegmentGroup }) {
  return (
    <Link
      href={`/segments/${climb.id}`}
      data-testid="climb-card"
      className="group flex w-full min-w-0 flex-col rounded-xl border border-surface-light/60 bg-surface p-3.5 text-left transition-colors hover:border-accent/40 hover:bg-surface-light/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-1.5">
            <CatChip category={climb.category} />
            <h3 className="line-clamp-2 min-h-[2.5rem] min-w-0 text-sm font-semibold leading-snug text-foreground">
              {climb.name}
            </h3>
          </div>
          <p className="mt-0.5 truncate text-xs text-muted">
            {climb.area ?? climb.region ?? climb.route_name ?? 'Climb'}
            {climb.route_count > 1 ? (
              <>
                <span className="text-muted/60"> · </span>
                {climb.route_count} routes
              </>
            ) : null}
          </p>
        </div>
        <div className="shrink-0 text-right">
          {climb.attempts > 0 ? (
            <>
              <p className="text-sm font-semibold tabular-nums text-positive">
                {fmtTime(climb.best?.seconds)}
              </p>
              <p className="text-xs text-muted tabular-nums">
                {climb.attempts} {climb.attempts === 1 ? 'ride' : 'rides'}
              </p>
            </>
          ) : (
            <>
              <p className="text-sm font-semibold tabular-nums text-foreground">
                {climb.difficulty != null ? climb.difficulty.toFixed(0) : '—'}
              </p>
              <p className="text-xs text-muted">difficulty</p>
            </>
          )}
        </div>
      </div>

      <ClimbProfile points={climb.profile} height={50} className="mt-2.5" />

      <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted tabular-nums">
        <span>
          {fmtKm(climb.distance_m)} · {climb.avg_gradient_pct.toFixed(1)}% ·{' '}
          {Math.round(climb.gain_m)} m
        </span>
        {climb.attempts > 0 && climb.best?.power_watts != null ? (
          <span>best {Math.round(climb.best.power_watts)} W</span>
        ) : (
          <span className="text-muted/70">
            steepest 200 m {climb.steepest_200m_pct.toFixed(1)}%
          </span>
        )}
      </div>
    </Link>
  );
}

export default function SegmentsPage() {
  usePageTitle('Climbs');
  const { authFetch, token } = useAuthFetch();
  const [tab, setTab] = useState<Tab>('ridden');
  const [q, setQ] = useState('');
  const [region, setRegion] = useState('all');
  const [sort, setSort] = useState<SortKey>('attempts');

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['segment-groups'],
    queryFn: () => getSegmentGroups(authFetch, { tab: 'all', limit: 200 }),
    enabled: !!token,
    staleTime: 300_000,
  });

  const all = data?.items ?? [];
  const counts = data?.counts ?? { ridden: 0, to_ride: 0, all: 0 };

  useEffect(() => {
    if (tab === 'to_ride' && (sort === 'attempts' || sort === 'recent')) {
      setSort('hardest');
    }
  }, [sort, tab]);

  const regions = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of all) {
      const r = c.region ?? 'Unknown';
      m.set(r, (m.get(r) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [all]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all
      .filter((c) => {
        if (tab === 'ridden' && c.attempts === 0) return false;
        if (tab === 'to_ride' && c.attempts > 0) return false;
        if (region !== 'all' && (c.region ?? 'Unknown') !== region) return false;
        if (!needle) return true;
        return (
          c.name.toLowerCase().includes(needle) ||
          (c.area ?? '').toLowerCase().includes(needle) ||
          (c.region ?? '').toLowerCase().includes(needle)
        );
      })
      .sort(SORTERS[sort]);
  }, [all, q, region, sort, tab]);

  // The hero is a shortcut into the visible set, not a global highlight: when a
  // search or area filter excludes a climb, the hero must not keep advertising
  // it above an empty grid.
  const featured = useMemo(() => {
    if (!visible.length) return undefined;
    if (tab === 'to_ride') {
      return [...visible].sort(
        (a, b) => (b.difficulty ?? 0) - (a.difficulty ?? 0)
      )[0];
    }
    return [...visible].sort(
      (a, b) =>
        b.attempts - a.attempts || (b.difficulty ?? 0) - (a.difficulty ?? 0)
    )[0];
  }, [tab, visible]);

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader
        title="Climbs"
        subtitle={
          data
            ? `Every hill your routes cross — ${counts.all} climbs, ${counts.ridden} ridden, ${counts.to_ride} still to ride.`
            : 'Every hill your routes cross, with the shape you ride.'
        }
        status={
          <ErrorState
            variant="inline"
            show={isError}
            message="Could not load climbs."
            onRetry={() => refetch()}
          />
        }
      />

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonLine key={i} className="h-44 w-full" />
          ))}
        </div>
      ) : all.length === 0 ? (
        <EmptyState
          icon={<Mountain className="h-8 w-8 text-muted" />}
          title="No climbs yet"
          description="Climbs are detected from the elevation profile of your routes. Sync a few cycling routes to build the atlas."
          action={{ label: 'Open routes', href: '/routes' }}
        />
      ) : (
        <>
          <div className="grid gap-3 lg:grid-cols-[1.55fr_1fr]">
            {featured ? (
              <Link
                href={`/segments/${featured.id}`}
                className="group flex h-full flex-col rounded-2xl border border-surface-light/60 bg-gradient-to-br from-surface to-surface-light/20 p-4 text-left transition-colors hover:border-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:p-5"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted">
                    {tab === 'to_ride'
                      ? 'Your next target'
                      : 'Your most-ridden climb'}
                  </p>
                  <ArrowUpRight className="h-4 w-4 text-muted transition-colors group-hover:text-accent" />
                </div>
                <div className="mt-1 flex items-start gap-2">
                  <CatChip category={featured.category} />
                  <h2 className="text-xl font-bold leading-tight text-foreground sm:text-2xl">
                    {featured.name}
                  </h2>
                </div>
                <p className="mt-1 text-xs text-muted">
                  {featured.area ??
                    featured.region ??
                    featured.route_name ??
                    'Climb'}{' '}
                  · {fmtKm(featured.distance_m)} at{' '}
                  {featured.avg_gradient_pct.toFixed(1)}%
                  {featured.attempts
                    ? ` · ${featured.attempts} attempts`
                    : ' · not ridden yet'}
                </p>
                <ClimbProfile
                  points={featured.profile}
                  height={84}
                  className="mt-3"
                />
                <div className="mt-3 flex flex-wrap items-end gap-x-7 gap-y-2">
                  {featured.attempts > 0 ? (
                    <>
                      <div>
                        <p className="text-xs text-muted">Best</p>
                        <p className="text-lg font-semibold tabular-nums text-positive">
                          {fmtTime(featured.best?.seconds)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted">Climb rate</p>
                        <p className="text-lg font-semibold tabular-nums text-foreground">
                          {featured.best?.vam ? (
                            <>
                              {Math.round(featured.best.vam)}
                              <span className="text-xs font-normal text-muted">
                                {' '}
                                m/h
                              </span>
                            </>
                          ) : (
                            '—'
                          )}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted">Last ridden</p>
                        <p className="text-lg font-semibold tabular-nums text-foreground">
                          {fmtDate(featured.last_ridden)}
                        </p>
                      </div>
                    </>
                  ) : (
                    <>
                      <div>
                        <p className="text-xs text-muted">Difficulty</p>
                        <p className="text-lg font-semibold tabular-nums text-foreground">
                          {featured.difficulty?.toFixed(0) ?? '—'}
                          <span className="text-xs font-normal text-muted">
                            {' '}
                            / 100
                          </span>
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted">Steepest 200 m</p>
                        <p className="text-lg font-semibold tabular-nums text-foreground">
                          {featured.steepest_200m_pct.toFixed(1)}%
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted">Climbing</p>
                        <p className="text-lg font-semibold tabular-nums text-foreground">
                          {Math.round(featured.gain_m)} m
                        </p>
                      </div>
                    </>
                  )}
                </div>
              </Link>
            ) : null}

            <section className="hidden h-full flex-col justify-between rounded-2xl border border-surface-light/60 bg-surface p-4 sm:p-5 lg:flex">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted">
                  Your climbing
                </p>
                <p className="mt-1 text-3xl font-bold tabular-nums text-foreground">
                  {counts.ridden}
                  <span className="ml-1 text-base font-medium text-muted">
                    / {counts.all}
                  </span>
                </p>
                <p className="mt-1 text-xs leading-relaxed text-muted">
                  hills with a measured attempt. The other {counts.to_ride} are
                  still waiting — each one has a real profile and a difficulty
                  score.
                </p>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 border-t border-surface-light/50 pt-3">
                <div>
                  <p className="text-xl font-bold tabular-nums text-foreground">
                    {counts.ridden}
                  </p>
                  <p className="text-xs text-muted">ridden</p>
                </div>
                <div>
                  <p className="text-xl font-bold tabular-nums text-foreground">
                    {counts.to_ride}
                  </p>
                  <p className="text-xs text-muted">to ride</p>
                </div>
              </div>
            </section>
          </div>

          <div className="flex flex-col gap-3 rounded-xl border border-surface-light/60 bg-surface p-3 sm:flex-row sm:items-center sm:justify-between">
            <SegmentedControl<Tab>
              options={[
                { value: 'ridden', label: `Your climbs ${counts.ridden}` },
                { value: 'to_ride', label: `To ride ${counts.to_ride}` },
                { value: 'all', label: `All ${counts.all}` },
              ]}
              value={tab}
              onChange={setTab}
              ariaLabel="Climb set"
            />

            <div className="flex flex-wrap items-center gap-2">
              <label className="relative w-full min-w-0 sm:w-auto">
                <span className="sr-only">Search climbs</span>
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search a climb or area"
                  className="min-h-[44px] w-full rounded-lg border border-surface-light/70 bg-surface-light/20 py-1.5 pl-8 pr-2.5 text-xs text-foreground placeholder:text-muted/70 focus:border-accent focus:outline-none sm:w-52"
                />
              </label>

              <label className="min-w-0">
                <span className="sr-only">Filter by area</span>
                <select
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                  className="min-h-[44px] rounded-lg border border-surface-light/70 bg-surface-light/20 px-2.5 text-xs text-foreground focus:border-accent focus:outline-none"
                >
                  <option value="all">All areas</option>
                  {regions.map(([r, n]) => (
                    <option key={r} value={r}>
                      {r} ({n})
                    </option>
                  ))}
                </select>
              </label>

              <label className="min-w-0">
                <span className="sr-only">Sort climbs</span>
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as SortKey)}
                  className="min-h-[44px] rounded-lg border border-surface-light/70 bg-surface-light/20 px-2.5 text-xs text-foreground focus:border-accent focus:outline-none"
                >
                  {SORTS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          <div className="flex items-baseline justify-between gap-2">
            <p className="text-xs text-muted tabular-nums">
              {visible.length} {visible.length === 1 ? 'climb' : 'climbs'}
            </p>
            {q || region !== 'all' ? (
              <button
                type="button"
                onClick={() => {
                  setQ('');
                  setRegion('all');
                }}
                className="min-h-[44px] text-xs text-accent hover:text-accent/80"
              >
                Clear filters
              </button>
            ) : null}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {visible.map((c) => (
              <ClimbCard key={c.id} climb={c} />
            ))}
          </div>

          <p className="pt-2 text-xs text-muted/80">
            Areas © OpenStreetMap contributors (ODbL). Profiles are derived from
            each route&apos;s polyline and elevation profile.
          </p>
        </>
      )}
    </div>
  );
}
