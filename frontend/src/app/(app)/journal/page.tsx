'use client';

/**
 * Activity Journal — the chronological training diary.
 *
 * This is the page the sidebar calls "Activity". Activities are grouped by
 * Monday-based week → day; each row is described by what the session actually
 * was (route / deterministic ride type / top exercise), never by
 * `Activity.name`, which is constant within each sport.
 *
 * Filters are URL-backed so a view is shareable, matching the deep-link
 * conventions used across the app.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useAuthFetch } from '@/lib/api';
import { apiFetchWithHeaders } from '@/lib/api/fetch';
import type { FetchResult } from '@/lib/api/fetch';
import type { Activity, ActivitySummary } from '@/lib/api';
import { useDeepLink } from '@/lib/useDeepLink';
import { usePageTitle } from '@/lib/usePageTitle';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { WeekSection } from '@/components/journal/WeekSection';
import { Search } from 'lucide-react';
import {
  JOURNAL_PERIODS,
  buildListParams,
  buildSummaryParams,
  formatRowDuration,
  formatVolumeKg,
  groupByWeek,
} from '@/lib/journal';
import type { JournalFilters } from '@/lib/journal';
import { formatDistance } from '@/lib/utils';

const PAGE_SIZE = 50;

const SPORT_OPTIONS = [
  { label: 'All sports', value: '' },
  { label: 'Rides', value: 'ride' },
  { label: 'Lifts', value: 'lift' },
] as const;

function parsePeriod(value: string | null): number {
  const match = JOURNAL_PERIODS.find((p) => String(p.days) === value);
  return match ? match.days : 30;
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[15px] font-semibold leading-none tabular-nums tracking-[-0.01em] text-foreground sm:text-[17px]">
        {value}
      </span>
      <span className="text-[9.5px] font-medium uppercase tracking-[0.13em] text-muted/50">{label}</span>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="space-y-8" aria-label="Loading activities">
      {[0, 1].map((i) => (
        <div key={i}>
          <div className="flex items-center justify-between">
            <div className="h-3.5 w-32 animate-pulse rounded bg-white/[0.07]" />
            <div className="h-3 w-44 animate-pulse rounded bg-white/[0.05]" />
          </div>
          <div className="mt-3 grid grid-cols-7 gap-1.5">
            {Array.from({ length: 7 }).map((_, d) => (
              <div key={d} className="h-[26px] animate-pulse rounded-[5px] bg-white/[0.045]" />
            ))}
          </div>
          <div className="mt-4 space-y-2 border-t border-white/[0.05] pt-4">
            {Array.from({ length: 2 }).map((_, r) => (
              <div key={r} className="flex items-center gap-3 py-2">
                <div className="h-11 w-11 animate-pulse rounded-[9px] bg-white/[0.055]" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-40 animate-pulse rounded bg-white/[0.065]" />
                  <div className="h-2.5 w-56 animate-pulse rounded bg-white/[0.04]" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function JournalPage() {
  usePageTitle('Activity');
  const { authFetch, token } = useAuthFetch();
  const { setParam } = useDeepLink();

  const [filters, setFilters] = useState<JournalFilters>({
    days: 30,
    sport: '',
    q: '',
    sort: 'date',
  });
  const [qInput, setQInput] = useState('');
  const [extraPages, setExtraPages] = useState<Activity[]>([]);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  // Read the shareable filters once from the URL (window, not useDeepLink, so
  // the read doesn't race the hook's own mount effect).
  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    const q = search.get('q') ?? '';
    setFilters({
      days: parsePeriod(search.get('period')),
      sport: search.get('sport') ?? '',
      q,
      sort: 'date',
    });
    setQInput(q);
  }, []);

  // setParam identity changes as the URL changes; keep it in a ref so the
  // debounce effect never re-fires on its own write.
  const setParamRef = useRef(setParam);
  setParamRef.current = setParam;

  const setPeriod = useCallback((days: number) => {
    setFilters((f) => ({ ...f, days }));
    setParamRef.current('period', days === 30 ? null : String(days));
  }, []);

  const setSport = useCallback((sport: string) => {
    setFilters((f) => ({ ...f, sport }));
    setParamRef.current('sport', sport || null);
  }, []);

  // Debounced search → filters + URL.
  useEffect(() => {
    const timer = setTimeout(() => {
      const q = qInput.trim();
      setFilters((f) => (f.q === q ? f : { ...f, q }));
      setParamRef.current('q', q || null);
    }, 300);
    return () => clearTimeout(timer);
  }, [qInput]);

  // Reset pagination (and the stale total) whenever the query inputs change.
  useEffect(() => {
    setExtraPages([]);
    setTotalCount(null);
  }, [filters.days, filters.sport, filters.q]);

  const listKey = ['journal-activities', filters.days, filters.sport, filters.q] as const;

  const { data: firstPage, isLoading, isError, refetch } = useQuery<Activity[]>({
    queryKey: listKey,
    queryFn: async () => {
      const params = buildListParams(filters, PAGE_SIZE, 0);
      params.set('include_context', 'true');
      const result: FetchResult<Activity[]> = await apiFetchWithHeaders<Activity[]>(
        `/api/v1/activities?${params.toString()}`,
        {},
        token,
      );
      const count = result.headers.get('X-Total-Count');
      if (count) setTotalCount(parseInt(count, 10));
      return result.data;
    },
    enabled: !!token,
  });

  const { data: summary } = useQuery<ActivitySummary>({
    queryKey: ['journal-summary', filters.days, filters.sport, filters.q],
    queryFn: () =>
      authFetch<ActivitySummary>(`/api/v1/activities/summary?${buildSummaryParams(filters).toString()}`),
    enabled: !!token,
  });

  const activities = useMemo(
    () => [...(firstPage ?? []), ...extraPages],
    [firstPage, extraPages],
  );
  const weeks = useMemo(() => groupByWeek(activities), [activities]);
  const maxSeconds = useMemo(
    () => Math.max(1, ...weeks.flatMap((week) => week.strip.map((day) => day.seconds))),
    [weeks],
  );

  const canLoadMore = totalCount != null && activities.length < totalCount;

  const handleLoadMore = useCallback(async () => {
    if (!token || !canLoadMore) return;
    setLoadingMore(true);
    try {
      const params = buildListParams(filters, PAGE_SIZE, activities.length);
      params.set('include_context', 'true');
      const result: FetchResult<Activity[]> = await apiFetchWithHeaders<Activity[]>(
        `/api/v1/activities?${params.toString()}`,
        {},
        token,
      );
      const count = result.headers.get('X-Total-Count');
      if (count) setTotalCount(parseInt(count, 10));
      setExtraPages((prev) => [...prev, ...result.data]);
    } finally {
      setLoadingMore(false);
    }
  }, [token, canLoadMore, filters, activities.length]);

  const hasActiveFilter = Boolean(filters.q || filters.sport);

  return (
    <div className="space-y-5 pb-20">
      <PageHeader
        title="Activity"
        subtitle="Every session, grouped by week."
        actions={
          // pr clears the shell's fixed notification bell at the top-right;
          // without it the search field ends underneath it.
          <div className="flex flex-wrap items-center gap-2 sm:pr-12">
            <div className="flex rounded-[9px] border border-surface-light/60 p-[3px]">
              {JOURNAL_PERIODS.map((period) => (
                <button
                  key={period.label}
                  type="button"
                  onClick={() => setPeriod(period.days)}
                  aria-pressed={filters.days === period.days}
                  className={`h-7 rounded-[6px] px-2.5 text-[11.5px] font-medium transition-colors ${
                    filters.days === period.days
                      ? 'bg-surface-light/70 text-foreground'
                      : 'text-muted hover:text-foreground'
                  }`}
                >
                  {period.label}
                </button>
              ))}
            </div>

            <select
              value={filters.sport}
              onChange={(event) => setSport(event.target.value)}
              aria-label="Filter by sport"
              className="h-8 rounded-[9px] border border-surface-light/60 bg-surface px-2 text-[11.5px] text-muted focus:border-accent/50 focus:outline-none"
            >
              {SPORT_OPTIONS.map((option) => (
                <option key={option.value || 'all'} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>

            <div className="relative w-full sm:w-auto">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted/50"
                aria-hidden
              />
              <input
                type="search"
                value={qInput}
                onChange={(event) => setQInput(event.target.value)}
                placeholder="Search rides, routes, lifts"
                aria-label="Search activities"
                className="h-8 w-full rounded-[9px] border border-surface-light/60 bg-surface pl-8 pr-2.5 text-[11.5px] text-foreground placeholder:text-muted/45 focus:border-accent/50 focus:outline-none sm:w-[196px]"
              />
            </div>
          </div>
        }
      />

      <ErrorState
        variant="inline"
        show={isError}
        message="Failed to load activities."
        onRetry={() => refetch()}
      />

      {!isError && summary && summary.count > 0 && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-4 border-y border-surface-light/40 py-4 sm:flex sm:flex-wrap sm:gap-x-9">
          <Stat value={String(summary.count)} label="sessions" />
          <Stat value={formatRowDuration(summary.total_duration_seconds)} label="moving" />
          {summary.total_distance_meters > 0 && (
            <Stat value={formatDistance(summary.total_distance_meters, 1)} label="distance" />
          )}
          {summary.total_tss > 0 && <Stat value={String(Math.round(summary.total_tss))} label="load (TSS)" />}
          {summary.total_volume_kg > 0 && (
            <Stat value={formatVolumeKg(summary.total_volume_kg).replace(' kg', '')} label="kg lifted" />
          )}
        </div>
      )}

      {isLoading ? (
        <Skeleton />
      ) : !isError && weeks.length === 0 ? (
        hasActiveFilter ? (
          <EmptyState
            title="No sessions match"
            description="Try a wider period, or clear the search and sport filter."
            icon={<Search className="h-8 w-8 text-muted" />}
            action={{
              label: 'Clear filters',
              onClick: () => {
                setQInput('');
                setSport('');
                setPeriod(30);
              },
            }}
          />
        ) : (
          <EmptyState
            title={filters.days > 0 ? `No sessions in the last ${filters.days} days` : 'No sessions yet'}
            description="Your training diary appears here once a ride or a lift is synced."
            icon={<Search className="h-8 w-8 text-muted" />}
          />
        )
      ) : (
        !isError && (
          <>
            <div>
              {weeks.map((week, index) => (
                <WeekSection key={week.weekStart} week={week} maxSeconds={maxSeconds} first={index === 0} />
              ))}
            </div>

            {canLoadMore && (
              <div className="flex justify-center pt-1">
                <Button onClick={handleLoadMore} disabled={loadingMore} variant="secondary" size="sm">
                  {loadingMore ? 'Loading…' : `Load more (${activities.length} of ${totalCount})`}
                </Button>
              </div>
            )}
          </>
        )
      )}

      <p className="pt-4 text-[11px] text-muted/45">
        Timeline, patterns and stats live in{' '}
        <Link
          href="/activities?view=list"
          className="text-muted/70 underline-offset-2 transition-colors hover:text-foreground hover:underline"
        >
          classic views
        </Link>
        .
      </p>
    </div>
  );
}
