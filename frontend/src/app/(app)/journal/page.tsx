'use client';

/**
 * Activity Journal — the chronological training diary.
 *
 * Replaces the bare `/activities` listing. Activities are grouped by
 * Monday-based week → day, each entry carries the full activity signal
 * (weather, route, power/HR, TSS provenance, ride context, linked lift) and
 * expands in place, and the period is summarised with server-accurate totals.
 *
 * Filters (period / sport / search / sort) are URL-backed so a view is
 * shareable, matching the deep-link conventions used across the app.
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
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Button } from '@/components/ui/Button';
import { Sparkline } from '@/components/ui/Sparkline';
import { SummaryStatsBar } from '@/components/activities/SummaryStatsBar';
import { JournalEntry } from '@/components/activities/JournalEntry';
import { formatDistance, formatDuration } from '@/lib/utils';
import {
  DEFAULT_JOURNAL_FILTERS,
  JOURNAL_PERIODS,
  JOURNAL_SORTS,
  buildListParams,
  buildSummaryParams,
  groupByWeek,
} from '@/lib/journal';
import type { JournalFilters, JournalSort } from '@/lib/journal';
import { BookOpen, Search } from 'lucide-react';

const PAGE_SIZE = 50;

const SPORT_OPTIONS = [
  { label: 'All sports', value: '' },
  { label: 'Cycling', value: 'cycling' },
  { label: 'Running', value: 'running' },
  { label: 'Swimming', value: 'swimming' },
  { label: 'Strength', value: 'weighttraining' },
  { label: 'Workout', value: 'workout' },
  { label: 'Hiking', value: 'hiking' },
  { label: 'Walking', value: 'walking' },
];

function parsePeriod(value: string | null): number {
  const match = JOURNAL_PERIODS.find((p) => String(p.days) === value);
  return match ? match.days : DEFAULT_JOURNAL_FILTERS.days;
}

function parseSort(value: string | null): JournalSort {
  const match = JOURNAL_SORTS.find((s) => s.value === value);
  return match ? match.value : DEFAULT_JOURNAL_FILTERS.sort;
}

export default function JournalPage() {
  usePageTitle('Activity Journal');
  const { authFetch, token } = useAuthFetch();
  const { setParam } = useDeepLink();

  const [filters, setFilters] = useState<JournalFilters>(DEFAULT_JOURNAL_FILTERS);
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
      sort: parseSort(search.get('sort')),
    });
    setQInput(q);
  }, []);

  // setParam identity changes as the URL changes; keep it in a ref so the
  // debounce effect never re-fires on its own write.
  const setParamRef = useRef(setParam);
  setParamRef.current = setParam;

  // ── Filter writers (URL-backed) ────────────────────────────────────────────
  const setPeriod = useCallback((days: number) => {
    setFilters((f) => ({ ...f, days }));
    setParamRef.current('period', days === DEFAULT_JOURNAL_FILTERS.days ? null : String(days));
  }, []);

  const setSport = useCallback((sport: string) => {
    setFilters((f) => ({ ...f, sport }));
    setParamRef.current('sport', sport || null);
  }, []);

  const setSort = useCallback((sort: JournalSort) => {
    setFilters((f) => ({ ...f, sort }));
    setParamRef.current('sort', sort === DEFAULT_JOURNAL_FILTERS.sort ? null : sort);
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
  }, [filters.days, filters.sport, filters.q, filters.sort]);

  // ── Data ───────────────────────────────────────────────────────────────────
  const listKey = ['journal-activities', filters.days, filters.sport, filters.q, filters.sort] as const;

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
    <div className="space-y-5">
      <PageHeader
        title="Activity Journal"
        subtitle="Every session, grouped by week."
        actions={
          <Link
            href="/activities?view=list"
            className="inline-flex min-h-[44px] items-center rounded-lg border border-surface-light px-3 py-2 text-xs font-medium text-muted transition-colors hover:border-accent/40 hover:text-foreground whitespace-nowrap"
          >
            Advanced views →
          </Link>
        }
      />

      {/* ── Filter bar ───────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-xl border border-surface-light/40 bg-surface p-1">
          {JOURNAL_PERIODS.map((p) => (
            <button
              key={p.label}
              onClick={() => setPeriod(p.days)}
              aria-pressed={filters.days === p.days}
              className={`min-h-[44px] rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                filters.days === p.days
                  ? 'bg-accent text-white'
                  : 'text-muted hover:bg-surface-light/50 hover:text-foreground'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="relative min-w-[180px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
          <input
            type="search"
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            placeholder="Search by name…"
            aria-label="Search activities by name"
            className="min-h-[44px] w-full rounded-lg border border-surface-light/40 bg-surface pl-9 pr-3 text-sm text-foreground placeholder:text-muted focus:border-accent/50 focus:outline-none"
          />
        </div>

        <select
          value={filters.sport}
          onChange={(e) => setSport(e.target.value)}
          aria-label="Filter by sport"
          className="min-h-[44px] rounded-lg border border-surface-light/40 bg-surface px-2 text-sm text-foreground"
        >
          {SPORT_OPTIONS.map((s) => (
            <option key={s.value || 'all'} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>

        <select
          value={filters.sort}
          onChange={(e) => setSort(e.target.value as JournalSort)}
          aria-label="Sort activities"
          className="min-h-[44px] rounded-lg border border-surface-light/40 bg-surface px-2 text-sm text-foreground"
        >
          {JOURNAL_SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      <ErrorState variant="inline" show={isError} message="Failed to load activities." onRetry={() => refetch()} />

      {/* ── Period summary ───────────────────────────────────────────────── */}
      {!isError && summary && summary.count > 0 && (
        <SummaryStatsBar summary={summary} activities={activities} />
      )}

      {/* ── Diary ────────────────────────────────────────────────────────── */}
      {isLoading ? (
        <div className="space-y-5" aria-label="Loading activities">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i}>
              <div className="mb-2 h-5 w-40 animate-pulse rounded bg-surface-light/50" />
              {Array.from({ length: 3 }).map((__, j) => (
                <div key={j} className="mb-2 h-14 animate-pulse rounded-lg bg-surface-light/40" />
              ))}
            </div>
          ))}
        </div>
      ) : !isError && weeks.length === 0 ? (
        hasActiveFilter ? (
          <EmptyState
            title="No activities match"
            description="Try a wider period or clear the search and sport filters."
            icon={<Search className="h-8 w-8 text-muted" />}
            action={{
              label: 'Clear filters',
              onClick: () => {
                setQInput('');
                setSport('');
                setPeriod(DEFAULT_JOURNAL_FILTERS.days);
              },
            }}
          />
        ) : (
          <EmptyState
            title="No activities yet"
            description="Your training diary appears here once you start tracking."
            icon={<BookOpen className="h-8 w-8 text-muted" />}
          />
        )
      ) : (
        !isError && (
          <>
            <div className="space-y-6">
              {weeks.map((week) => (
                <section key={week.weekStart}>
                  {/* Week header — rhythm + rollup */}
                  <div className="mb-2 flex items-center justify-between gap-3 border-b border-surface-light/40 pb-2">
                    <div className="flex items-baseline gap-3">
                      <h3 className="text-sm font-semibold text-foreground">Week of {week.label}</h3>
                      <span className="text-xs text-muted tabular-nums">
                        {week.count} {week.count === 1 ? 'session' : 'sessions'}
                        {week.distanceMeters > 0 ? ` · ${formatDistance(week.distanceMeters, 1)}` : ''}
                        {week.durationSeconds > 0 ? ` · ${formatDuration(week.durationSeconds)}` : ''}
                        {week.tss > 0 ? ` · ${Math.round(week.tss)} TSS` : ''}
                      </span>
                    </div>
                    <div className="hidden w-28 shrink-0 sm:block" title="Daily TSS, Mon–Sun">
                      <Sparkline data={week.rhythm} height={22} area />
                    </div>
                  </div>

                  {week.days.map((day) => (
                    <div key={day.date} className="mb-3">
                      <div className="flex items-baseline justify-between gap-3 px-1">
                        <h4 className="text-xs font-medium uppercase tracking-wider text-muted">{day.label}</h4>
                        <span className="text-xs text-muted tabular-nums">
                          {day.tss > 0 ? `${Math.round(day.tss)} TSS` : ''}
                        </span>
                      </div>
                      <div>
                        {day.activities.map((activity) => (
                          <JournalEntry key={activity.id} activity={activity} />
                        ))}
                      </div>
                    </div>
                  ))}
                </section>
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
    </div>
  );
}
