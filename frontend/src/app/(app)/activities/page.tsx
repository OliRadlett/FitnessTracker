'use client';

import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthFetch } from '@/lib/api';
import type {
  Activity,
  ActivityContext,
  ActivityDetail,
  ActivitySummary,
  CalendarDayData,
  ChartData,
  ActivityFilters,
  RideAnalysis,
} from '@/lib/api';
import { useDeepLink } from '@/lib/useDeepLink';
import { RideAnalysisCard } from '@/components/cycling/RideAnalysisCard';
import { ActivityAiAnalysisCard } from '@/components/cycling/ActivityAiAnalysisCard';
import { FuelPlanCard } from '@/components/cycling/FuelPlanCard';
import { WeatherBadge } from '@/components/cycling/WeatherBadge';
import dynamic from 'next/dynamic';

const RouteMap = dynamic(
  () => import('@/components/maps/RouteMap').then((mod) => mod.RouteMap),
  { ssr: false, loading: () => <div className="h-[250px] bg-surface-light/20 rounded-lg animate-pulse" /> },
);
import { Card } from '@/components/ui/Card';
import { Chart } from '@/components/charts/Chart';
import { SkeletonRow } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatDuration, formatDistance } from '@/lib/utils';
import { usePageTitle } from '@/lib/usePageTitle';
import { STRENGTH_TYPES } from '@/lib/sportUtils';
import { SummaryStatsBar } from '@/components/activities/SummaryStatsBar';
import { ActivityCard } from '@/components/activities/ActivityCard';
import { ActivityConnectionsBar } from '@/components/activities/ActivityConnectionsBar';
import { ActivityContextBadges } from '@/components/activities/ActivityContextBadges';
import { ActivityHealthOverlay } from '@/components/activities/ActivityHealthOverlay';
import { CompareActivitiesModal } from '@/components/activities/CompareActivitiesModal';
import { TimelineView } from '@/components/activities/TimelineView';
import { PatternsView } from '@/components/activities/PatternsView';

// ── Helpers ──────────────────────────────────────────────────────────────────

const SPORT_TYPES = ['', 'cycling', 'running', 'swimming', 'walking', 'hiking', 'weighttraining', 'workout'];
const SOURCES = ['', 'strava', 'wahoo', 'komoot', 'manual'];

const SORT_OPTIONS: { label: string; sort_by: string; sort_order: string }[] = [
  { label: 'Date (newest)', sort_by: 'start_date', sort_order: 'desc' },
  { label: 'Date (oldest)', sort_by: 'start_date', sort_order: 'asc' },
  { label: 'Distance \u2193', sort_by: 'distance', sort_order: 'desc' },
  { label: 'Distance \u2191', sort_by: 'distance', sort_order: 'asc' },
  { label: 'Duration \u2193', sort_by: 'duration', sort_order: 'desc' },
  { label: 'Duration \u2191', sort_by: 'duration', sort_order: 'asc' },
  { label: 'TSS \u2193', sort_by: 'tss', sort_order: 'desc' },
  { label: 'TSS \u2191', sort_by: 'tss', sort_order: 'asc' },
  { label: 'Power \u2193', sort_by: 'average_power', sort_order: 'desc' },
  { label: 'Power \u2191', sort_by: 'average_power', sort_order: 'asc' },
];

function getISOWeek(date: Date): string {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  const weekNum = 1 + Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
  return `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

function getWeekDateRange(weekKey: string, activities: Activity[]): string {
  const weekActivities = activities.filter((a) => getISOWeek(new Date(a.start_date)) === weekKey);
  if (weekActivities.length === 0) return '';
  const dates = weekActivities.map((a) => new Date(a.start_date));
  const min = new Date(Math.min(...dates.map((d) => d.getTime())));
  const max = new Date(Math.max(...dates.map((d) => d.getTime())));
  return `${min.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} \u2013 ${max.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`;
}

// ── Expanded Activity Detail ─────────────────────────────────────────────────

function ActivityExpanded({
  activity,
  activityDetail,
  context,
}: {
  activity: Activity;
  activityDetail?: ActivityDetail;
  context?: ActivityContext | null;
}) {
  const { authFetch } = useAuthFetch();
  const streamTypes = activityDetail?.streams?.map((s) => s.stream_type) ?? [];
  const [selectedStream, setSelectedStream] = useState<string>('');

  const isCycling = activity.sport_type === 'cycling';

  // Fetch ride analysis for cycling activities
  const { data: rideAnalysis } = useQuery<RideAnalysis>({
    queryKey: ['ride-analysis', activity.id],
    queryFn: () => authFetch<RideAnalysis>(`/api/v1/activities/${activity.id}/analysis`),
    enabled: isCycling,
  });

  const streamChart: ChartData | null = activityDetail?.streams?.length
    ? (() => {
        const stream = activityDetail.streams!.find((s) => s.stream_type === (selectedStream || streamTypes[0]));
        if (!stream) return null;
        const streamData = stream.data as Record<string, unknown>;
        const values = (streamData?.data as number[]) ?? [];
        return {
          chart_type: 'line' as const,
          title: `${stream.stream_type} over time`,
          labels: values.map((_, i) => String(i)),
          x_label: 'Sample',
          y_label: stream.stream_type,
          series: [{
            name: stream.stream_type,
            data: values,
          }],
        };
      })()
    : null;

  // Stop context propagation when clicking inside expanded detail
  const handleStopClick = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div className="mt-4 pt-4 border-t border-surface-light/50" onClick={handleStopClick}>
      {/* Connections Bar — PR/Plan/AI/Fuel badges */}
      {context?.connections && (
        <div className="mb-3">
          <ActivityConnectionsBar connections={context.connections} activityId={activity.id} />
        </div>
      )}

      {/* Analytical context badges (IF/VI/decoupling/speed/climbing/EF/load) */}
      {context?.ride_metrics || context?.load_context ? (
        <div className="mb-3">
          <ActivityContextBadges context={context} />
        </div>
      ) : null}

      {/* Health overlay (HRV/recovery/sleep from day before) */}
      {context?.health_overlay && (
        <div className="mb-3">
          <ActivityHealthOverlay health={context.health_overlay} />
        </div>
      )}

      {/* Weather at activity time */}
      {(activity.weather_temperature != null || activity.weather_conditions) && (
        <div className="mb-3 text-sm text-muted">
          <WeatherBadge
            temperature={activity.weather_temperature ?? null}
            conditions={activity.weather_conditions ?? null}
            wind_speed_kmh={activity.weather_wind_speed_kmh ?? null}
            wind_direction={activity.weather_wind_direction ?? null}
            precipitation_mm={activity.weather_precipitation_mm ?? null}
          />
        </div>
      )}

      {/* Route Map */}
      {activity.encoded_polyline && (
        <div className="mb-4">
          <RouteMap encodedPolyline={activity.encoded_polyline} className="h-[250px]" />
        </div>
      )}

      {/* Stream Data */}
      {streamTypes.length > 0 ? (
        <>
          <div className="flex gap-2 mb-4">
            {streamTypes.map((st) => (
              <button
                key={st}
                onClick={() => setSelectedStream(st)}
                className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                  (selectedStream || streamTypes[0]) === st
                    ? 'bg-accent/20 text-accent border-accent/30'
                    : 'text-muted border-surface-light hover:border-accent/30'
                }`}
              >
                {st}
              </button>
            ))}
          </div>
          {streamChart && <Chart data={streamChart} height={250} />}
        </>
      ) : (
        <p className="text-muted text-sm">No stream data available</p>
      )}

      {/* Ride Analysis Card — cycling activities only */}
      {isCycling && rideAnalysis && (
        <div className="mt-4">
          <RideAnalysisCard analysis={rideAnalysis} />
        </div>
      )}

      {/* AI Ride Analysis — cycling activities only */}
      {isCycling && (
        <div className="mt-4">
          <ActivityAiAnalysisCard activityId={activity.id} />
        </div>
      )}

      {/* Ride Fuel Plan — cycling activities only */}
      {isCycling && (
        <div className="mt-4">
          <FuelPlanCard activity={activity} />
        </div>
      )}
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function ActivitiesPage() {
  usePageTitle('Activities');
  const { authFetch, authFetchWithHeaders, authUpload } = useAuthFetch();
  const queryClient = useQueryClient();
  const { getParam, setParam } = useDeepLink();
  const [filters, setFilters] = useState<ActivityFilters>({});
  const [selectedActivityId, setSelectedActivityId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'week' | 'timeline' | 'patterns'>('list');
  const [allActivities, setAllActivities] = useState<Activity[] | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const PAGE_SIZE = 50;

  // Deep-link: select the activity referenced by ?activity=<id> on load
  useEffect(() => {
    const id = getParam('activity');
    if (id) setSelectedActivityId((prev) => (prev === id ? prev : id));
  }, [getParam]);

  const handleSelectActivity = useCallback((id: string | null) => {
    setSelectedActivityId(id);
    setParam('activity', id);
  }, [setParam]);

  // ── Advanced filters state ───────────────────────────────────────────────
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [sortIndex, setSortIndex] = useState(0);
  const [advMinDist, setAdvMinDist] = useState('');
  const [advMaxDist, setAdvMaxDist] = useState('');
  const [advMinDur, setAdvMinDur] = useState('');
  const [advMaxDur, setAdvMaxDur] = useState('');
  const [advMinTss, setAdvMinTss] = useState('');
  const [advMaxTss, setAdvMaxTss] = useState('');

  // ── Comparison state ─────────────────────────────────────────────────────
  const [selectedForComparison, setSelectedForComparison] = useState<Set<string>>(new Set());
  const [compareModalOpen, setCompareModalOpen] = useState(false);

  // ── File import state ────────────────────────────────────────────────────
  const gpxInputRef = useRef<HTMLInputElement>(null);
  const fitInputRef = useRef<HTMLInputElement>(null);
  const [importLoading, setImportLoading] = useState<string | null>(null); // 'gpx' | 'fit' | null
  const [importMessage, setImportMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showImportMenu, setShowImportMenu] = useState(false);

  const handleFileImport = useCallback(async (file: File, type: 'gpx' | 'fit') => {
    setImportLoading(type);
    setImportMessage(null);
    try {
      const endpoint = type === 'gpx' ? '/api/v1/activities/import-gpx' : '/api/v1/activities/import-fit';
      const formData = new FormData();
      formData.append('file', file);
      await authUpload<Activity>(endpoint, formData);
      setImportMessage({ type: 'success', text: `Successfully imported ${file.name}` });
      queryClient.invalidateQueries({ queryKey: ['activities'] });
      queryClient.invalidateQueries({ queryKey: ['activities-calendar'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
    } catch (err) {
      setImportMessage({ type: 'error', text: err instanceof Error ? err.message : 'Import failed' });
    } finally {
      setImportLoading(null);
      // Reset file inputs so the same file can be re-selected
      if (gpxInputRef.current) gpxInputRef.current.value = '';
      if (fitInputRef.current) fitInputRef.current.value = '';
    }
  }, [authUpload, queryClient]);

  // Build merged filters object for the query
  const effectiveFilters: ActivityFilters = useMemo(() => {
    const f: ActivityFilters = { ...filters };
    if (searchText.trim()) f.q = searchText.trim();
    const sort = SORT_OPTIONS[sortIndex];
    if (sort) {
      f.sort_by = sort.sort_by;
      f.sort_order = sort.sort_order;
    }
    if (advMinDist) f.min_distance = parseFloat(advMinDist) * 1000; // km → meters
    if (advMaxDist) f.max_distance = parseFloat(advMaxDist) * 1000;
    if (advMinDur) f.min_duration = parseInt(advMinDur, 10) * 60; // minutes → seconds
    if (advMaxDur) f.max_duration = parseInt(advMaxDur, 10) * 60;
    if (advMinTss) f.min_tss = parseFloat(advMinTss);
    if (advMaxTss) f.max_tss = parseFloat(advMaxTss);
    return f;
  }, [filters, searchText, sortIndex, advMinDist, advMaxDist, advMinDur, advMaxDur, advMinTss, advMaxTss]);

  const activitiesUrl = useMemo(() => {
    const params = new URLSearchParams();
    Object.entries(effectiveFilters).forEach(([key, value]) => {
      if (value !== undefined && value !== '') {
        params.append(key, String(value));
      }
    });
    params.set('limit', String(PAGE_SIZE));
    params.set('offset', '0');
    const query = params.toString();
    return `/api/v1/activities${query ? `?${query}` : ''}`;
  }, [effectiveFilters]);

  const { data: activities, isLoading } = useQuery<Activity[]>({
    queryKey: ['activities', effectiveFilters],
    queryFn: async () => {
      const result = await authFetchWithHeaders<Activity[]>(activitiesUrl);
      const countHeader = result.headers.get('X-Total-Count');
      if (countHeader) setTotalCount(parseInt(countHeader, 10));
      return result.data;
    },
  });

  // Fetch context for the expanded activity (lazy / on-demand)
  const { data: expandedContext } = useQuery<ActivityContext>({
    queryKey: ['activity-context', selectedActivityId],
    queryFn: () => authFetch<ActivityContext>(`/api/v1/activities/${selectedActivityId}/context`),
    enabled: !!selectedActivityId,
    staleTime: 1000 * 60 * 10, // 10 minutes — context doesn't change often
  });

  // Sync query data to local state for append behaviour
  React.useEffect(() => {
    if (activities) {
      setAllActivities(activities);
    }
  }, [activities]);

  // Reset when filters change
  React.useEffect(() => {
    setAllActivities(null);
    setTotalCount(null);
  }, [effectiveFilters]);

  async function loadMore() {
    if (!allActivities || loadingMore) return;
    setLoadingMore(true);
    try {
      const params = new URLSearchParams();
      Object.entries(effectiveFilters).forEach(([key, value]) => {
        if (value !== undefined && value !== '') {
          params.append(key, String(value));
        }
      });
      params.set('limit', String(PAGE_SIZE));
      params.set('offset', String(allActivities.length));
      const query = params.toString();
      const result = await authFetchWithHeaders<Activity[]>(`/api/v1/activities${query ? `?${query}` : ''}`);
      setAllActivities((prev) => [...(prev || []), ...result.data]);
    } catch {
      // ignore
    } finally {
      setLoadingMore(false);
    }
  }

  const displayActivities = allActivities ?? activities ?? [];
  const hasMore = totalCount !== null
    ? displayActivities.length < totalCount
    : displayActivities.length % PAGE_SIZE === 0;

  // ── Bulk actions state ──────────────────────────────────────────────────
  const [selectMode, setSelectMode] = useState(false);
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set());

  const toggleBulkSelect = useCallback((id: string) => {
    setBulkSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAllBulk = useCallback(() => {
    setBulkSelected(new Set(displayActivities.map((a) => a.id)));
  }, [displayActivities]);

  const clearBulk = useCallback(() => {
    setBulkSelected(new Set());
    setSelectMode(false);
  }, []);

  const exportCsv = useCallback(() => {
    const selected = displayActivities.filter((a) => bulkSelected.has(a.id));
    if (selected.length === 0) return;

    const headers = ['Name', 'Sport', 'Date', 'Distance (km)', 'Duration (s)', 'Avg Power', 'TSS'];
    const rows = selected.map((a) => [
      `"${(a.name || '').replace(/"/g, '""')}"`,
      a.sport_type,
      a.start_date,
      a.distance_meters ? (a.distance_meters / 1000).toFixed(2) : '',
      a.duration_seconds || '',
      a.average_power || '',
      a.tss ?? '',
    ]);

    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `activities-export-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }, [displayActivities, bulkSelected]);

  const { data: activityDetail } = useQuery<ActivityDetail>({
    queryKey: ['activity', selectedActivityId],
    queryFn: () => authFetch<ActivityDetail>(`/api/v1/activities/${selectedActivityId}`),
    enabled: !!selectedActivityId,
  });

  // Fetch aggregate totals across ALL matching activities (not just the current page)
  const summaryParams = useMemo(() => {
    const params = new URLSearchParams();
    Object.entries(effectiveFilters).forEach(([key, value]) => {
      if (value !== undefined && value !== '' && !['sort_by', 'sort_order', 'limit', 'offset'].includes(key)) {
        params.append(key, String(value));
      }
    });
    return params.toString();
  }, [effectiveFilters]);

  const { data: activitySummary } = useQuery<ActivitySummary>({
    queryKey: ['activity-summary', summaryParams],
    queryFn: () => authFetch<ActivitySummary>(`/api/v1/activities/summary${summaryParams ? `?${summaryParams}` : ''}`),
    enabled: viewMode !== 'timeline' && viewMode !== 'patterns' && displayActivities.length > 0,
  });

  // Deep-linked activity that isn't in the currently loaded list (e.g. opened
  // from route history or calendar) — render its detail from the fetched record.
  const selectedActivity = useMemo(() => {
    if (!selectedActivityId) return undefined;
    const inList = displayActivities.find((a) => a.id === selectedActivityId);
    if (inList) return inList;
    return activityDetail;
  }, [selectedActivityId, displayActivities, activityDetail]);

  // Group activities by ISO week for week view
  const weekGroups = useMemo(() => {
    if (displayActivities.length === 0 || viewMode !== 'week') return [];
    const groups = new Map<string, Activity[]>();
    for (const a of displayActivities) {
      const key = getISOWeek(new Date(a.start_date));
      const existing = groups.get(key);
      if (existing) {
        existing.push(a);
      } else {
        groups.set(key, [a]);
      }
    }
    return Array.from(groups.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [displayActivities, viewMode]);

  // Comparison helpers
  const toggleCompare = useCallback((id: string) => {
    setSelectedForComparison((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else if (next.size < 2) {
        next.add(id);
      }
      return next;
    });
  }, []);

  const compareActivities = useMemo(() => {
    if (selectedForComparison.size !== 2) return null;
    const ids = Array.from(selectedForComparison);
    const a = displayActivities.find((x) => x.id === ids[0]);
    const b = displayActivities.find((x) => x.id === ids[1]);
    if (!a || !b) return null;
    return [a, b] as [Activity, Activity];
  }, [selectedForComparison, displayActivities]);

  function clearAllFilters() {
    setFilters({});
    setSearchText('');
    setSortIndex(0);
    setAdvMinDist('');
    setAdvMaxDist('');
    setAdvMinDur('');
    setAdvMaxDur('');
    setAdvMinTss('');
    setAdvMaxTss('');
  }

  const hasActiveFilters = Object.keys(filters).length > 0 || searchText.trim() !== '' || sortIndex !== 0
    || advMinDist !== '' || advMaxDist !== '' || advMinDur !== '' || advMaxDur !== '' || advMinTss !== '' || advMaxTss !== '';

  // Fetch a larger dataset for Timeline & Patterns views (last 6 months, up to 200 activities)
  const sixMonthsAgo = useMemo(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 6);
    return d.toISOString().split('T')[0];
  }, []);

  const { data: statsActivities, isLoading: statsLoading } = useQuery<Activity[]>({
    queryKey: ['activities-stats'],
    queryFn: () => authFetch<Activity[]>(`/api/v1/activities?start_date_after=${sixMonthsAgo}&limit=200&sort_by=start_date&sort_order=desc`),
    enabled: viewMode === 'timeline' || viewMode === 'patterns',
  });

  // Calendar data for timeline view (last 30 days by default)
  const thirtyDaysAgo = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  }, []);
  const today = useMemo(() => new Date().toISOString().split('T')[0], []);

  const { data: calendarData, isLoading: calendarLoading } = useQuery<CalendarDayData>({
    queryKey: ['activities-calendar', thirtyDaysAgo, today],
    queryFn: () => authFetch<CalendarDayData>(
      `/api/v1/activities/calendar?start_date=${thirtyDaysAgo}&end_date=${today}`,
    ),
    enabled: viewMode === 'timeline',
  });

  function renderWeekGroup(weekKey: string, weekActivities: Activity[]) {
    const totalDist = weekActivities.reduce((s, a) => s + (STRENGTH_TYPES.includes(a.sport_type) ? 0 : (a.distance_meters || 0)), 0);
    const totalTime = weekActivities.reduce((s, a) => s + (a.duration_seconds || 0), 0);
    const totalTss = weekActivities.reduce((s, a) => s + (a.tss || 0), 0);
    const dateRange = getWeekDateRange(weekKey, weekActivities);

    // Find max values across all week groups for relative bar sizing
    const maxDist = Math.max(...weekGroups.map(([, acts]) =>
      acts.reduce((s, a) => s + (STRENGTH_TYPES.includes(a.sport_type) ? 0 : (a.distance_meters || 0)), 0)
    ), 1);
    const maxTss = Math.max(...weekGroups.map(([, acts]) =>
      acts.reduce((s, a) => s + (a.tss || 0), 0)
    ), 1);

    const distPct = Math.round((totalDist / maxDist) * 100);
    const tssPct = Math.round((totalTss / maxTss) * 100);

    return (
      <div key={weekKey} className="space-y-3">
        <div className="flex items-center gap-4 py-2 px-1">
          <h3 className="text-sm font-semibold text-white">{weekKey}</h3>
          {dateRange && <span className="text-xs text-muted">{dateRange}</span>}
          <div className="flex items-center gap-4 text-xs text-muted ml-auto">
            <span>{weekActivities.length} activities</span>
            {totalDist > 0 && (
              <span className="flex items-center gap-1.5">
                {'\u{1F4CF}'} {formatDistance(totalDist)}
                <span className="inline-block h-1.5 rounded-full bg-green-500/60" style={{ width: `${Math.max(distPct * 0.4, 4)}px` }} />
              </span>
            )}
            <span>{'\u23F1\uFE0F'} {formatDuration(totalTime)}</span>
            {totalTss > 0 && (
              <span className="flex items-center gap-1.5">
                {'\u{1F4AA}'} {Math.round(totalTss)} TSS
                <span className="inline-block h-1.5 rounded-full bg-purple-500/60" style={{ width: `${Math.max(tssPct * 0.4, 4)}px` }} />
              </span>
            )}
          </div>
        </div>
        {weekActivities.map((activity) => (
          <React.Fragment key={activity.id}>
            <ActivityCard
              activity={activity}
              isSelected={selectedActivityId === activity.id}
              onSelect={() => handleSelectActivity(selectedActivityId === activity.id ? null : activity.id)}
              showCompareCheckbox={viewMode === 'list'}
              isCompareSelected={selectedForComparison.has(activity.id)}
              onToggleCompare={() => toggleCompare(activity.id)}
            />
            {selectedActivityId === activity.id && (
              <ActivityExpanded activity={activity} activityDetail={activityDetail} context={expandedContext} />
            )}
          </React.Fragment>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Activities</h1>
          <p className="text-muted">Browse and analyze your fitness activities</p>
        </div>
        {/* View Toggle */}
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-surface rounded-lg border border-surface-light overflow-hidden" role="tablist" aria-label="Activity view mode">
          <button
            onClick={() => setViewMode('list')}
            role="tab"
            aria-selected={viewMode === 'list'}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              viewMode === 'list' ? 'bg-accent text-white' : 'text-muted hover:text-white'
            }`}
          >
            List
          </button>
          <button
            onClick={() => setViewMode('week')}
            role="tab"
            aria-selected={viewMode === 'week'}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              viewMode === 'week' ? 'bg-accent text-white' : 'text-muted hover:text-white'
            }`}
          >
            Week
          </button>
          <button
            onClick={() => setViewMode('timeline')}
            role="tab"
            aria-selected={viewMode === 'timeline'}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              viewMode === 'timeline' ? 'bg-accent text-white' : 'text-muted hover:text-white'
            }`}
          >
            Timeline
          </button>
          <button
            onClick={() => setViewMode('patterns')}
            role="tab"
            aria-selected={viewMode === 'patterns'}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              viewMode === 'patterns' ? 'bg-accent text-white' : 'text-muted hover:text-white'
            }`}
          >
            Patterns
          </button>
        </div>
          <button
            onClick={() => { setSelectMode(!selectMode); if (selectMode) setBulkSelected(new Set()); }}
            className={`px-3 py-2 text-sm font-medium rounded-lg border transition-colors ${
              selectMode
                ? 'bg-accent/20 text-accent border-accent/30'
                : 'text-muted hover:text-white border-surface-light hover:bg-surface-light/50'
            }`}
          >
            {selectMode ? 'Cancel' : 'Select'}
          </button>
          <div className="relative">
            <button
              onClick={() => setShowImportMenu(!showImportMenu)}
              className="px-3 py-2 text-sm font-medium rounded-lg border text-muted hover:text-white border-surface-light hover:bg-surface-light/50 transition-colors"
            >
              Import
            </button>
            {showImportMenu && (
              <div className="absolute right-0 mt-1 bg-surface border border-surface-light rounded-lg shadow-xl z-30 py-1 min-w-[140px]">
                <label className="flex items-center gap-2 px-3 py-2 text-sm text-muted hover:text-white hover:bg-surface-light/50 cursor-pointer">
                  {'\u{1F4C4}'} Import GPX
                  <input ref={gpxInputRef} type="file" accept=".gpx" className="hidden" disabled={!!importLoading}
                    onChange={(e) => { const file = e.target.files?.[0]; if (file) handleFileImport(file, 'gpx'); setShowImportMenu(false); }} />
                </label>
                <label className="flex items-center gap-2 px-3 py-2 text-sm text-muted hover:text-white hover:bg-surface-light/50 cursor-pointer">
                  {'\u231A'} Import FIT
                  <input ref={fitInputRef} type="file" accept=".fit" className="hidden" disabled={!!importLoading}
                    onChange={(e) => { const file = e.target.files?.[0]; if (file) handleFileImport(file, 'fit'); setShowImportMenu(false); }} />
                </label>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Import status banner */}
      {importMessage && (
        <div className={`flex items-center justify-between px-4 py-2.5 rounded-lg border ${
          importMessage.type === 'success'
            ? 'bg-positive/10 border-positive/20 text-positive'
            : 'bg-warning/10 border-warning/20 text-warning'
        }`}>
          <span className="text-sm">{importMessage.type === 'success' ? '\u2713' : '\u2717'} {importMessage.text}</span>
          <button onClick={() => setImportMessage(null)} className="text-sm opacity-60 hover:opacity-100">{'\u2715'}</button>
        </div>
      )}

      {/* Filter Bar — Tier 1 (always visible) */}
      <Card>
        <div className="flex flex-wrap gap-3 items-center">
          <div className="flex-1 min-w-[160px]">
            <input
              type="text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Search activities..."
              className="w-full bg-surface-light border border-surface-light text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent placeholder:text-muted/60"
            />
          </div>
          <select
            value={filters.sport_type || ''}
            onChange={(e) => setFilters({ ...filters, sport_type: e.target.value || undefined })}
            className="bg-surface-light border border-surface-light text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
          >
            {SPORT_TYPES.map((type) => (
              <option key={type} value={type}>{type || 'All Sports'}</option>
            ))}
          </select>
          <select
            value={sortIndex}
            onChange={(e) => setSortIndex(parseInt(e.target.value, 10))}
            className="bg-surface-light border border-surface-light text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
          >
            {SORT_OPTIONS.map((opt, i) => (
              <option key={i} value={i}>{opt.label}</option>
            ))}
          </select>
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className={`px-3 py-2 text-sm border rounded-lg transition-colors inline-flex items-center gap-1.5 ${
              showAdvanced
                ? 'bg-accent/20 text-accent border-accent/30'
                : 'text-muted hover:text-white border-surface-light hover:bg-surface-light/50'
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" /></svg>
            Filters
            {hasActiveFilters && (
              <span className="ml-1 px-1.5 py-0.5 text-[10px] font-semibold bg-accent text-white rounded-full">
                {[
                  filters.sport_type && 1,
                  filters.start_date_after && 1,
                  filters.start_date_before && 1,
                  filters.source && 1,
                  advMinDist && 1,
                  advMaxDist && 1,
                  advMinDur && 1,
                  advMaxDur && 1,
                  advMinTss && 1,
                  advMaxTss && 1,
                ].filter(Boolean).length}
              </span>
            )}
          </button>
          {hasActiveFilters && (
            <button
              onClick={clearAllFilters}
              className="px-3 py-2 text-sm text-accent hover:text-accent/80 transition-colors"
            >
              Clear
            </button>
          )}
        </div>

        {/* Tier 2 — collapsible advanced filters */}
        {showAdvanced && (
          <div className="mt-4 pt-4 border-t border-surface-light/30 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs text-muted mb-1">Start Date</label>
              <input type="date" value={filters.start_date_after || ''}
                onChange={(e) => setFilters({ ...filters, start_date_after: e.target.value || undefined })}
                className="w-full bg-surface-light border border-surface-light text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent" />
            </div>
            <div>
              <label className="block text-xs text-muted mb-1">End Date</label>
              <input type="date" value={filters.start_date_before || ''}
                onChange={(e) => setFilters({ ...filters, start_date_before: e.target.value || undefined })}
                className="w-full bg-surface-light border border-surface-light text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent" />
            </div>
            <div>
              <label className="block text-xs text-muted mb-1">Source</label>
              <select value={filters.source || ''}
                onChange={(e) => setFilters({ ...filters, source: e.target.value || undefined })}
                className="w-full bg-surface-light border border-surface-light text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent">
                {SOURCES.map((src) => (
                  <option key={src} value={src}>{src || 'All Sources'}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-muted mb-1">Min Distance (km)</label>
              <input type="number" min="0" step="0.1" value={advMinDist} onChange={(e) => setAdvMinDist(e.target.value)}
                className="w-full bg-surface-light border border-surface-light text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent placeholder:text-muted/60" placeholder="0" />
            </div>
            <div>
              <label className="block text-xs text-muted mb-1">Max Distance (km)</label>
              <input type="number" min="0" step="0.1" value={advMaxDist} onChange={(e) => setAdvMaxDist(e.target.value)}
                className="w-full bg-surface-light border border-surface-light text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent placeholder:text-muted/60" placeholder={'\u221E'} />
            </div>
            <div>
              <label className="block text-xs text-muted mb-1">Min Duration (min)</label>
              <input type="number" min="0" step="1" value={advMinDur} onChange={(e) => setAdvMinDur(e.target.value)}
                className="w-full bg-surface-light border border-surface-light text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent placeholder:text-muted/60" placeholder="0" />
            </div>
            <div>
              <label className="block text-xs text-muted mb-1">Max Duration (min)</label>
              <input type="number" min="0" step="1" value={advMaxDur} onChange={(e) => setAdvMaxDur(e.target.value)}
                className="w-full bg-surface-light border border-surface-light text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent placeholder:text-muted/60" placeholder={'\u221E'} />
            </div>
            <div>
              <label className="block text-xs text-muted mb-1">Min TSS</label>
              <input type="number" min="0" step="1" value={advMinTss} onChange={(e) => setAdvMinTss(e.target.value)}
                className="w-full bg-surface-light border border-surface-light text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent placeholder:text-muted/60" placeholder="0" />
            </div>
            <div>
              <label className="block text-xs text-muted mb-1">Max TSS</label>
              <input type="number" min="0" step="1" value={advMaxTss} onChange={(e) => setAdvMaxTss(e.target.value)}
                className="w-full bg-surface-light border border-surface-light text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent placeholder:text-muted/60" placeholder={'\u221E'} />
            </div>
          </div>
        )}
      </Card>

      {/* Summary Stats */}
      {viewMode !== 'timeline' && viewMode !== 'patterns' && displayActivities.length > 0 && (
        <div className="space-y-2">
          <SummaryStatsBar
            activities={displayActivities}
            summary={activitySummary ?? undefined}
          />
          {totalCount !== null && totalCount > displayActivities.length && (
            <p className="text-xs text-muted text-center">
              Showing {displayActivities.length} of {totalCount} activities
            </p>
          )}
        </div>
      )}

      {/* Activity List / Timeline / Patterns */}
      <div aria-live="polite">
      {viewMode === 'timeline' ? (
        calendarLoading ? (
          <div className="space-y-3" aria-label="Loading timeline">
            {Array.from({ length: 5 }).map((_, i) => (
              <SkeletonRow key={i} />
            ))}
          </div>
        ) : (
          <TimelineView
            startDate={thirtyDaysAgo}
            endDate={today}
            calendarData={calendarData ?? { activities: [], daily_metrics: [], sleep_logs: [] }}
          />
        )
      ) : viewMode === 'patterns' ? (
        <PatternsView
          activities={displayActivities}
          statsActivities={statsActivities ?? []}
          isLoading={statsLoading}
          onPatternSelect={(newFilters) => {
            setFilters(newFilters);
            setSearchText('');
            setSortIndex(0);
            setAdvMinDist('');
            setAdvMaxDist('');
            setAdvMinDur('');
            setAdvMaxDur('');
            setAdvMinTss('');
            setAdvMaxTss('');
            setViewMode('list');
          }}
        />
      ) : isLoading ? (
        <div className="space-y-3" aria-label="Loading activities">
          {Array.from({ length: 5 }).map((_, i) => (
            <SkeletonRow key={i} />
          ))}
        </div>
      ) : displayActivities.length > 0 ? (
        viewMode === 'week' ? (
          <div className="space-y-6">
            {weekGroups.map(([weekKey, weekActivities]) => renderWeekGroup(weekKey, weekActivities))}
          </div>
        ) : (
          <div className="space-y-3">
            {displayActivities.map((activity) => (
              <React.Fragment key={activity.id}>
                <ActivityCard
                  activity={activity}
                  isSelected={selectedActivityId === activity.id}
                  onSelect={() => handleSelectActivity(selectedActivityId === activity.id ? null : activity.id)}
                  showCompareCheckbox={viewMode === 'list' && !selectMode}
                  isCompareSelected={selectedForComparison.has(activity.id)}
                  onToggleCompare={() => toggleCompare(activity.id)}
                  showBulkCheckbox={selectMode}
                  isBulkSelected={bulkSelected.has(activity.id)}
                  onToggleBulk={() => toggleBulkSelect(activity.id)}
                />
                {selectedActivityId === activity.id && (
                  <ActivityExpanded activity={activity} activityDetail={activityDetail} context={expandedContext} />
                )}
              </React.Fragment>
            ))}
          </div>
        )
      ) : (
        <EmptyState
          icon={"\u{1F3C3}"}
          title="No activities yet"
          description="Connect Strava to sync your first activity, or use the filters above to search existing data."
          action={{ label: 'Go to Settings', href: '/settings' }}
        />
      )}
      </div>

      {/* Deep-linked activity outside the loaded list */}
      {selectedActivity && !displayActivities.some((a) => a.id === selectedActivity.id) && (
        <div className="space-y-3">
          <ActivityCard
            activity={selectedActivity}
            isSelected
            onSelect={() => handleSelectActivity(null)}
          />
          <ActivityExpanded activity={selectedActivity} activityDetail={activityDetail} context={expandedContext} />
        </div>
      )}

      {/* Load More */}
      {!isLoading && viewMode !== 'timeline' && viewMode !== 'patterns' && displayActivities.length > 0 && hasMore && (
        <div className="text-center py-4">
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="px-6 py-3 text-sm font-medium bg-accent/20 hover:bg-accent/30 text-accent border border-accent/30 rounded-lg transition-colors disabled:opacity-50"
          >
            {loadingMore
              ? 'Loading...'
              : `Load More${totalCount !== null ? ` (${displayActivities.length} of ${totalCount})` : ''}`}
          </button>
        </div>
      )}

      {/* Compare floating bar */}
      {selectedForComparison.size === 2 && compareActivities && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-surface border border-accent/30 rounded-xl shadow-2xl px-6 py-3 flex items-center gap-4">
          <span className="text-sm text-muted">2 rides selected</span>
          <button
            onClick={() => setCompareModalOpen(true)}
            className="px-4 py-2 text-sm font-medium bg-accent text-white rounded-lg hover:bg-accent/80 transition-colors"
          >
            Compare 2 rides
          </button>
          <button
            onClick={() => setSelectedForComparison(new Set())}
            className="text-sm text-muted hover:text-white transition-colors"
          >
            Clear
          </button>
        </div>
      )}

      {/* Bulk actions floating bar */}
      {selectMode && bulkSelected.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-surface border border-accent/30 rounded-xl shadow-2xl px-6 py-3 flex items-center gap-4">
          <span className="text-sm font-medium text-white">{bulkSelected.size} selected</span>
          <button
            onClick={selectAllBulk}
            className="text-sm text-muted hover:text-white transition-colors"
          >
            Select All
          </button>
          <button
            onClick={() => setBulkSelected(new Set())}
            className="text-sm text-muted hover:text-white transition-colors"
          >
            Deselect All
          </button>
          <button
            onClick={exportCsv}
            className="px-4 py-2 text-sm font-medium bg-accent text-white rounded-lg hover:bg-accent/80 transition-colors"
          >
            Export CSV
          </button>
          <button
            onClick={clearBulk}
            className="text-sm text-muted hover:text-white transition-colors"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Compare modal */}
      {compareModalOpen && compareActivities && (
        <CompareActivitiesModal
          activityA={compareActivities[0]}
          activityB={compareActivities[1]}
          onClose={() => setCompareModalOpen(false)}
        />
      )}
    </div>
  );
}
