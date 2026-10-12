'use client';

/**
 * Activity Journal — V2 replacement for /activities.
 *
 * Chronological diary: activities grouped by day with inline sparkline
 * per card. Top bar for date range + sport filter. Desktop 2-column,
 * mobile single-column.
 */

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useAuthFetch } from '@/lib/api';
import { usePageTitle } from '@/lib/usePageTitle';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Badge, getSportBadgeVariant } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Sparkline } from '@/components/ui/Sparkline';
import { formatDistance, formatDuration, getActiveLocale } from '@/lib/utils';
import { toDateStr } from '@/lib/training/week';
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
  sparklineData?: (number | null | undefined)[];
  maxTss: number;
}

function JournalCard({ activity, sparklineData, maxTss }: JournalCardProps) {
  const tss = activity.tss ?? 0;
  const tssPct = maxTss > 0 ? Math.min(100, (tss / maxTss) * 100) : 0;
  const isStrength = activity.sport_type.includes('strength') || activity.sport_type.includes('workout') || activity.sport_type.includes('weight');
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
              {primaryValue && (
                <p className="text-xs text-muted">{primaryValue}</p>
              )}
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

          {sparklineData && sparklineData.length > 1 && (
            <div className="mt-1 h-4 -mx-1">
              <Sparkline data={sparklineData} height={16} color="rgb(var(--muted))" />
            </div>
          )}
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
  const { authFetch, token } = useAuthFetch();

  const [period, setPeriod] = useState<{ label: string; days: number }>(DATE_PERIODS[2]);
  const [sportFilter, setSportFilter] = useState('');

  const daysAgo = period.days > 0 ? period.days : 3650;

  const {
    data: activities,
    isLoading,
    isError,
  } = useQuery<Activity[]>({
    queryKey: ['journal-activities', daysAgo, sportFilter],
    queryFn: async () => {
      const params = new URLSearchParams({
        start_date_after: toDateStr(new Date(new Date().setDate(new Date().getDate() - daysAgo))),
        limit: String(PAGE_SIZE),
        sort_by: 'start_date',
        sort_order: 'desc',
      });
      if (sportFilter) params.set('sport_type', sportFilter);
      const result = await authFetch<Activity[]>(`/api/v1/activities?${params.toString()}`);
      return result;
    },
    enabled: !!token,
  });

  const maxTss = useMemo(
    () => Math.max(...(activities?.map((a) => a.tss ?? 0) ?? [0]), 1),
    [activities],
  );

  const dayGroups = useMemo(() => {
    return activities ? groupByDay(activities) : [];
  }, [activities]);

  const handlePeriodChange = (p: { label: string; days: number }) => {
    setPeriod(p);
  };

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
        subtitle={`${activities?.length ?? 0} activities in ${period.label}`}
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

      <ErrorState
        variant="inline"
        show={isError}
        message="Failed to load activities."
      />

      {!isError && dayGroups.length === 0 ? (
        <EmptyState
          title="No activities yet"
          description="Your activity journal will appear here once you start tracking."
          icon="📔"
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {dayGroups.map((group) => (
            <div key={group.date}>
              <h3 className="text-sm font-medium text-muted mb-2">
                {group.label}
              </h3>
              <div className="space-y-2">
                {group.activities.map((activity) => {
                  const hasStream = activity.has_streams;
                  const primaryMetric = activity.tss ?? activity.distance_meters ?? activity.duration_seconds ?? 0;
                  const sparklineData = hasStream && activity.tss
                    ? [primaryMetric]
                    : undefined;

                  return (
                    <JournalCard
                      key={activity.id}
                      activity={activity}
                      sparklineData={sparklineData}
                      maxTss={maxTss}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
