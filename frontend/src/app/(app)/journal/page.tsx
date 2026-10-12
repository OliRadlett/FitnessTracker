'use client';

/**
 * Activity Journal — V2 replacement for /activities.
 *
 * Chronological diary: activities grouped by day with inline sparklines.
 * Top bar with date range + sport filter, paginated "Load more" at the bottom.
 * Desktop 2-column, mobile single-column.
 */

import React, { useMemo, useState, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useAuthFetch } from '@/lib/api';
import { apiFetchWithHeaders } from '@/lib/api/fetch';
import type { FetchResult } from '@/lib/api/fetch';
import { usePageTitle } from '@/lib/usePageTitle';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Badge, getSportBadgeVariant } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Button } from '@/components/ui/Button';
import { formatDistance, formatDuration, getActiveLocale } from '@/lib/utils';
  import { toDateStr } from '@/lib/training/week';
  import { BookOpen } from 'lucide-react';
  import type { Activity } from '@/lib/api';

const PAGE_SIZE = 50;

const DATE_PERIODS = [
  { label: 'Today', days: 1 },
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
  { label: 'All', days: 0 },
] as const;

const SPORT_FILTERS = [
  { label: 'All', value: '' },
  { label: 'Cycling', value: 'cycling' },
  { label: 'Running', value: 'running' },
  { label: 'Strength', value: 'strength' },
  { label: 'Swimming', value: 'swimming' },
];

interface JournalCardProps {
  activity: Activity;
  maxTss: number;
}

function JournalCard({ activity, maxTss }: JournalCardProps) {
  const tss = activity.tss ?? 0;
  const tssPct = maxTss > 0 ? Math.min(100, (tss / maxTss) * 100) : 0;
  const isStrength =
    activity.sport_type.includes('strength') ||
    activity.sport_type.includes('workout') ||
    activity.sport_type.includes('weight');
  const primaryValue = isStrength
    ? activity.duration_seconds
      ? formatDuration(activity.duration_seconds)
      : null
    : activity.distance_meters
      ? formatDistance(activity.distance_meters)
      : activity.duration_seconds
      ? formatDuration(activity.duration_seconds)
      : null;

  return (
    <Link href={`/activities?activity=${activity.id}`} className="block group">
      <Card className="p-3 hover:border-surface-light/50 transition-colors">
        <div className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant={getSportBadgeVariant(activity.sport_type)}>
              {activity.sport_type}
            </Badge>
            <p className="font-medium text-foreground truncate group-hover:text-accent transition-colors">
              {activity.name}
            </p>
            {activity.sources && activity.sources.length > 0 && (
              <span
                className="text-xs text-muted"
                title={`via ${activity.sources[0]?.provider}`}
              >
                {activity.sources[0]?.provider}
              </span>
            )}
          </div>

          <div className="flex items-center justify-between gap-4">
            <div className="flex-1 min-w-0">
              <p className="text-sm text-muted">
                {new Date(activity.start_date).toLocaleDateString(getActiveLocale(), {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                })}
              </p>
              {primaryValue && <p className="text-xs text-muted">{primaryValue}</p>}
            </div>

            {tss > 0 && (
              <div className="flex items-end gap-2 shrink-0">
                <span className="text-xs text-muted tabular-nums">TSS {tss.toFixed(0)}</span>
                <div className="w-12 h-8">
                  <div
                    className="h-full rounded bg-accent/30"
                    style={{ height: `${Math.max(8, tssPct)}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </Card>
    </Link>
  );
}

interface DayGroup {
  label: string;
  date: string;
  activities: Activity[];
}

function groupByDay(activities: Activity[]): DayGroup[] {
  const today = toDateStr(new Date());
  const yesterday = toDateStr(new Date(new Date().setDate(new Date().getDate() - 1)));

  const groups = new Map<string, Activity[]>();
  activities.forEach((a) => {
    const date = a.start_date.split('T')[0];
    if (!groups.has(date)) groups.set(date, []);
    groups.get(date)!.push(a);
  });

  return Array.from(groups.entries())
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([date, acts]) => {
      let label: string;
      if (date === today) label = 'Today';
      else if (date === yesterday) label = 'Yesterday';
      else {
        const d = new Date(date + 'T00:00:00');
        label = d.toLocaleDateString(getActiveLocale(), {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          year: date.startsWith(today.slice(0, 4)) ? undefined : 'numeric',
        });
      }
      return { label, date, activities: acts };
    });
}

export default function JournalPage() {
  usePageTitle('Activity Journal');
  const { token } = useAuthFetch();

  const [period, setPeriod] = useState<{ label: string; days: number }>(DATE_PERIODS[2]);
  const [sportFilter, setSportFilter] = useState('');
  const [allActivities, setAllActivities] = useState<Activity[]>([]);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const daysAgo = period.days > 0 ? period.days : 3650;

  const { data: firstPage, isLoading, isError } = useQuery<Activity[]>({
    queryKey: ['journal-activities', daysAgo, sportFilter],
    queryFn: async () => {
      const params = new URLSearchParams({
        start_date_after: toDateStr(new Date(new Date().setDate(new Date().getDate() - daysAgo))),
        limit: String(PAGE_SIZE),
        sort_by: 'start_date',
        sort_order: 'desc',
      });
      if (sportFilter) params.set('sport_type', sportFilter);
      const result: FetchResult<Activity[]> = await apiFetchWithHeaders<Activity[]>(`/api/v1/activities?${params.toString()}`, {}, token);
      const count = result.headers.get('X-Total-Count');
      if (count) setTotalCount(parseInt(count, 10));
      return result.data;
    },
    enabled: !!token,
  });

  /* Sync first page into allActivities whenever the query key changes */
  useEffect(() => {
    if (firstPage) {
      setAllActivities(firstPage);
    }
  }, [firstPage]);

  /* Reset pagination when period or sport changes */
  useEffect(() => {
    setAllActivities([]);
  }, [daysAgo, sportFilter]);

  const maxTss = useMemo(
    () => Math.max(...(allActivities.map((a) => a.tss ?? 0)), 1),
    [allActivities],
  );

  const dayGroups = useMemo(() => groupByDay(allActivities), [allActivities]);

  const canLoadMore = totalCount != null && allActivities.length < totalCount;
  const hasMore = allActivities.length > 0 && (!totalCount || allActivities.length < (totalCount ?? Infinity));

  const handleLoadMore = useCallback(async () => {
    if (!token || !canLoadMore) return;
    setLoadingMore(true);
    try {
      const params = new URLSearchParams({
        start_date_after: toDateStr(new Date(new Date().setDate(new Date().getDate() - daysAgo))),
        limit: String(PAGE_SIZE),
        offset: String(allActivities.length),
        sort_by: 'start_date',
        sort_order: 'desc',
      });
      if (sportFilter) params.set('sport_type', sportFilter);
      const result: FetchResult<Activity[]> = await apiFetchWithHeaders<Activity[]>(
        `/api/v1/activities?${params.toString()}`,
        {},
        token,
      );
      const count = result.headers.get('X-Total-Count');
      if (count) setTotalCount(parseInt(count, 10));
      setAllActivities((prev) => [...prev, ...result.data]);
    } finally {
      setLoadingMore(false);
    }
  }, [token, daysAgo, sportFilter, allActivities.length, canLoadMore]);

  const handlePeriodChange = useCallback((p: { label: string; days: number }) => {
    setPeriod(p);
  }, []);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <PageHeader title="Activity Journal" subtitle="Loading your activities…" />
        <div className="space-y-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i}>
              <div className="h-5 w-32 mb-2 bg-surface-light/50 rounded animate-pulse" />
              {Array.from({ length: 3 }).map((_, j) => (
                <div key={j} className="h-20 bg-surface-light/50 rounded-lg mb-2 animate-pulse" />
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Activity Journal"
        subtitle={`${allActivities.length} activities${totalCount != null ? ` / ${totalCount} total` : ''}`}
        actions={
          <div className="flex items-center gap-2">
            <div className="flex gap-1 bg-surface rounded-xl p-1 border border-surface/20 overflow-x-auto">
              {DATE_PERIODS.map((p) => (
                <button
                  key={p.label}
                  onClick={() => handlePeriodChange(p)}
                  className={`min-h-[44px] px-3 py-2 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                    period.days === p.days
                      ? 'bg-accent text-white'
                      : 'text-muted hover:text-foreground hover:bg-surface-light/50'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <select
              value={sportFilter}
              onChange={(e) => setSportFilter(e.target.value)}
              className="min-h-[44px] text-sm rounded-lg bg-surface border border-surface/20 text-foreground px-2 tabular-nums"
              aria-label="Filter by sport"
            >
              {SPORT_FILTERS.map((s) => (
                <option key={s.value || 'all'} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        }
      />

      <ErrorState variant="inline" show={isError} message="Failed to load activities." />

      {!isError && dayGroups.length === 0 ? (
        <EmptyState
          title="No activities yet"
          description="Your activity journal will appear here once you start tracking."
          icon={<BookOpen className="w-8 h-8 text-muted" />}
        />
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {dayGroups.map((group) => (
              <div key={group.date}>
                <h3 className="text-sm font-medium text-muted mb-2">{group.label}</h3>
                <div className="space-y-2">
                  {group.activities.map((activity) => (
                    <JournalCard key={activity.id} activity={activity} maxTss={maxTss} />
                  ))}
                </div>
              </div>
            ))}
          </div>

          {hasMore && (
            <div className="flex justify-center">
              <Button
                onClick={handleLoadMore}
                disabled={loadingMore || !canLoadMore}
                variant="secondary"
                size="sm"
              >
                {loadingMore ? 'Loading…' : 'Load more'}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
