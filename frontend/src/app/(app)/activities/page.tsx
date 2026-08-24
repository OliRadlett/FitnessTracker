'use client';

import React, { useState, useMemo, useRef, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthFetch } from '@/lib/api';
import { formatDuration } from '@/lib/utils';
import type { Activity, ActivityDetail, ChartData, ActivityFilters, ActivitySource, RideAnalysis } from '@/lib/api';
import { RideAnalysisCard } from '@/components/cycling/RideAnalysisCard';
import { ActivityAiAnalysisCard } from '@/components/cycling/ActivityAiAnalysisCard';
import { FuelPlanCard } from '@/components/cycling/FuelPlanCard';
import { WeatherBadge } from '@/components/cycling/WeatherBadge';
import dynamic from 'next/dynamic';

const RouteMap = dynamic(
  () => import('@/components/maps/RouteMap').then((mod) => mod.RouteMap),
  { ssr: false, loading: () => <div className="h-[250px] bg-surface-light/20 rounded-lg animate-pulse" /> },
);
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge, getSportBadgeVariant } from '@/components/ui/Badge';
import { Chart } from '@/components/charts/Chart';
import { SkeletonRow } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatDistance(meters: number): string {
  return `${(meters / 1000).toFixed(2)} km`;
}

const STRENGTH_TYPES = ['weighttraining', 'workout', 'crossfit', 'strength_training'];

const PROVIDER_COLORS: Record<string, string> = {
  strava: 'bg-orange-500',
  komoot: 'bg-green-600',
  wahoo: 'bg-blue-500',
  manual: 'bg-gray-500',
};

const PROVIDER_ICONS: Record<string, string> = {
  strava: '/icons/strava.svg',
  komoot: '/icons/komoot.svg',
  wahoo: '/icons/wahoo.svg',
  manual: '',
};

function ProviderIcon({ provider, size = 12 }: { provider: string; size?: number }) {
  const src = PROVIDER_ICONS[provider];
  if (src) {
    return <img src={src} alt={`${provider} logo`} className="inline-block" style={{ width: size, height: size }} />;
  }
  return <span aria-hidden="true">✏️</span>;
}

const SPORT_TYPES = ['', 'cycling', 'running', 'swimming', 'walking', 'hiking', 'weighttraining', 'workout'];
const SOURCES = ['', 'strava', 'wahoo', 'komoot', 'manual'];

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
  return `${min.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${max.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`;
}

// ── Source Badges ────────────────────────────────────────────────────────────

function SourceBadges({ sources }: { sources?: ActivitySource[] }) {
  if (!sources || sources.length === 0) return null;
  return (
    <div className="flex items-center gap-1">
      {sources.map((s) => (
        <span
          key={s.id}
          className={`inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full text-white ${PROVIDER_COLORS[s.provider] || 'bg-gray-500'}`}
          title={`${s.provider}: ${s.provider_name || s.provider_activity_id}`}
        >
          <ProviderIcon provider={s.provider} /> {s.provider}
        </span>
      ))}
    </div>
  );
}

// ── Summary Stats Bar ────────────────────────────────────────────────────────

function SummaryStatsBar({ activities }: { activities: Activity[] }) {
  const stats = useMemo(() => {
    const totalDistance = activities.reduce((sum, a) => {
      if (STRENGTH_TYPES.includes(a.sport_type)) return sum;
      return sum + (a.distance_meters || 0);
    }, 0);
    const totalTime = activities.reduce((sum, a) => sum + (a.duration_seconds || 0), 0);
    const totalTss = activities.reduce((sum, a) => sum + (a.tss || 0), 0);
    return { totalDistance, totalTime, totalTss, count: activities.length };
  }, [activities]);

  if (stats.count === 0) return null;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <div className="bg-surface rounded-lg p-3 border border-surface-light/30">
        <p className="text-lg font-bold text-white">{stats.count}</p>
        <p className="text-xs text-muted">Activities</p>
      </div>
      <div className="bg-surface rounded-lg p-3 border border-surface-light/30">
        <p className="text-lg font-bold text-green-400">{formatDistance(stats.totalDistance)}</p>
        <p className="text-xs text-muted">Total Distance</p>
      </div>
      <div className="bg-surface rounded-lg p-3 border border-surface-light/30">
        <p className="text-lg font-bold text-blue-400">{formatDuration(stats.totalTime)}</p>
        <p className="text-xs text-muted">Total Time</p>
      </div>
      <div className="bg-surface rounded-lg p-3 border border-surface-light/30">
        <p className="text-lg font-bold text-purple-400">{Math.round(stats.totalTss)}</p>
        <p className="text-xs text-muted">Total TSS</p>
      </div>
    </div>
  );
}

// ── Activity Card ────────────────────────────────────────────────────────────

function ActivityCard({
  activity,
  isSelected,
  onSelect,
}: {
  activity: Activity;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const isStrength = STRENGTH_TYPES.includes(activity.sport_type);

  return (
    <Card
      onClick={onSelect}
      className={isSelected ? 'border-accent/50' : ''}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Badge variant={getSportBadgeVariant(activity.sport_type)}>
            {activity.sport_type}
          </Badge>
          <div>
            <div className="flex items-center gap-2">
              <p className="font-medium text-white">{activity.name}</p>
              <SourceBadges sources={activity.sources} />
            </div>
            <p className="text-xs text-muted">
              {new Date(activity.start_date).toLocaleString()}
              {activity.route_name && (
                <span className="ml-2 text-accent">📍 {activity.route_name}</span>
              )}
              <WeatherBadge
                temperature={activity.weather_temperature ?? null}
                conditions={activity.weather_conditions ?? null}
                wind_speed_kmh={activity.weather_wind_speed_kmh ?? null}
              />
            </p>
          </div>
        </div>
        <div className="flex items-center gap-6 text-right">
          {!isStrength && activity.distance_meters && (
            <div>
              <p className="text-sm text-slate-300">{formatDistance(activity.distance_meters)}</p>
              <p className="text-xs text-muted">Distance</p>
            </div>
          )}
          {activity.duration_seconds && (
            <div>
              <p className="text-sm text-slate-300">{formatDuration(activity.duration_seconds)}</p>
              <p className="text-xs text-muted">Duration</p>
            </div>
          )}
          {!isStrength && activity.average_power && (
            <div>
              <p className="text-sm text-yellow-400">{activity.average_power} W</p>
              <p className="text-xs text-muted">Avg Power</p>
            </div>
          )}
          {activity.tss !== undefined && activity.tss !== null && (
            <div>
              <p className="text-sm text-blue-400">{activity.tss}</p>
              <p className="text-xs text-muted">TSS</p>
            </div>
          )}
        </div>
      </div>

      {/* Linked Lifting Session indicator */}
      {activity.linked_lifting_session && (
        <div className="mt-3 p-3 bg-purple-500/10 border border-purple-500/20 rounded-lg">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-medium text-purple-400 bg-purple-400/10 px-2 py-0.5 rounded">Lifting</span>
            <span className="text-sm text-white">{activity.linked_lifting_session.focus || 'Lifting Session'}</span>
          </div>
          <div className="flex gap-4 text-xs text-muted">
            <span>{new Date(activity.linked_lifting_session.session_date).toLocaleDateString()}</span>
            <span>{activity.linked_lifting_session.set_count} sets</span>
            {activity.linked_lifting_session.total_volume_kg && (
              <span>{Math.round(activity.linked_lifting_session.total_volume_kg).toLocaleString()} kg volume</span>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

// ── Expanded Activity Detail ─────────────────────────────────────────────────

function ActivityExpanded({
  activity,
  activityDetail,
}: {
  activity: Activity;
  activityDetail?: ActivityDetail;
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

  return (
    <div className="mt-4 pt-4 border-t border-surface-light/50">
      {/* Weather at activity time */}
      {(activity.weather_temperature != null || activity.weather_conditions) && (
        <div className="mb-3 text-sm text-muted">
          <WeatherBadge
            temperature={activity.weather_temperature ?? null}
            conditions={activity.weather_conditions ?? null}
            wind_speed_kmh={activity.weather_wind_speed_kmh ?? null}
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
  const { authFetch, authFetchWithHeaders, authUpload } = useAuthFetch();
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<ActivityFilters>({});
  const [selectedActivityId, setSelectedActivityId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'week'>('list');
  const [allActivities, setAllActivities] = useState<Activity[] | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const PAGE_SIZE = 50;

  // ── File import state ────────────────────────────────────────────────────
  const gpxInputRef = useRef<HTMLInputElement>(null);
  const fitInputRef = useRef<HTMLInputElement>(null);
  const [importLoading, setImportLoading] = useState<string | null>(null); // 'gpx' | 'fit' | null
  const [importMessage, setImportMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

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

  const activitiesUrl = useMemo(() => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== '') {
        params.append(key, String(value));
      }
    });
    params.set('limit', String(PAGE_SIZE));
    params.set('offset', '0');
    const query = params.toString();
    return `/api/v1/activities${query ? `?${query}` : ''}`;
  }, [filters]);

  const { data: activities, isLoading } = useQuery<Activity[]>({
    queryKey: ['activities', filters],
    queryFn: async () => {
      const result = await authFetchWithHeaders<Activity[]>(activitiesUrl);
      const countHeader = result.headers.get('X-Total-Count');
      if (countHeader) setTotalCount(parseInt(countHeader, 10));
      return result.data;
    },
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
  }, [filters]);

  async function loadMore() {
    if (!allActivities || loadingMore) return;
    setLoadingMore(true);
    try {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([key, value]) => {
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

  const { data: activityDetail } = useQuery<ActivityDetail>({
    queryKey: ['activity', selectedActivityId],
    queryFn: () => authFetch<ActivityDetail>(`/api/v1/activities/${selectedActivityId}`),
    enabled: !!selectedActivityId,
  });

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

  function renderWeekGroup(weekKey: string, weekActivities: Activity[]) {
    const totalDist = weekActivities.reduce((s, a) => s + (STRENGTH_TYPES.includes(a.sport_type) ? 0 : (a.distance_meters || 0)), 0);
    const totalTime = weekActivities.reduce((s, a) => s + (a.duration_seconds || 0), 0);
    const totalTss = weekActivities.reduce((s, a) => s + (a.tss || 0), 0);
    const dateRange = getWeekDateRange(weekKey, weekActivities);

    return (
      <div key={weekKey} className="space-y-3">
        <div className="flex items-center gap-4 py-2 px-1">
          <h3 className="text-sm font-semibold text-white">{weekKey}</h3>
          {dateRange && <span className="text-xs text-muted">{dateRange}</span>}
          <div className="flex items-center gap-4 text-xs text-muted ml-auto">
            <span>{weekActivities.length} activities</span>
            {totalDist > 0 && <span>📏 {formatDistance(totalDist)}</span>}
            <span>⏱️ {formatDuration(totalTime)}</span>
            {totalTss > 0 && <span>💪 {Math.round(totalTss)} TSS</span>}
          </div>
        </div>
        {weekActivities.map((activity) => (
          <React.Fragment key={activity.id}>
            <ActivityCard
              activity={activity}
              isSelected={selectedActivityId === activity.id}
              onSelect={() => setSelectedActivityId(selectedActivityId === activity.id ? null : activity.id)}
            />
            {selectedActivityId === activity.id && (
              <ActivityExpanded activity={activity} activityDetail={activityDetail} />
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
        </div>
      </div>

      {/* File Import */}
      <Card>
        <div className="flex flex-wrap gap-4 items-center">
          <span className="text-sm font-medium text-white">Import File</span>

          {/* GPX upload */}
          <label
            className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border cursor-pointer transition-colors ${
              importLoading === 'gpx'
                ? 'bg-accent/10 text-accent border-accent/30 opacity-60 cursor-wait'
                : 'bg-surface-light border-surface-light text-muted hover:text-white hover:bg-surface-light/80'
            }`}
          >
            {importLoading === 'gpx' ? (
              <span className="inline-block w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            ) : (
              '📄'
            )}
            {importLoading === 'gpx' ? 'Importing…' : 'Import GPX'}
            <input
              ref={gpxInputRef}
              type="file"
              accept=".gpx"
              className="hidden"
              disabled={!!importLoading}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFileImport(file, 'gpx');
              }}
            />
          </label>

          {/* FIT upload */}
          <label
            className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border cursor-pointer transition-colors ${
              importLoading === 'fit'
                ? 'bg-accent/10 text-accent border-accent/30 opacity-60 cursor-wait'
                : 'bg-surface-light border-surface-light text-muted hover:text-white hover:bg-surface-light/80'
            }`}
          >
            {importLoading === 'fit' ? (
              <span className="inline-block w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            ) : (
              '⌚'
            )}
            {importLoading === 'fit' ? 'Importing…' : 'Import FIT'}
            <input
              ref={fitInputRef}
              type="file"
              accept=".fit"
              className="hidden"
              disabled={!!importLoading}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFileImport(file, 'fit');
              }}
            />
          </label>

          {/* Status message */}
          {importMessage && (
            <span
              className={`text-sm ${importMessage.type === 'success' ? 'text-green-400' : 'text-red-400'}`}
            >
              {importMessage.type === 'success' ? '✓' : '✗'} {importMessage.text}
            </span>
          )}
        </div>
      </Card>

      {/* Filter Bar */}
      <Card>
        <div className="flex flex-wrap gap-4 items-end">
          <div>
            <label className="block text-xs text-muted mb-1">Sport Type</label>
            <select
              value={filters.sport_type || ''}
              onChange={(e) => setFilters({ ...filters, sport_type: e.target.value || undefined })}
              className="bg-surface-light border border-surface-light text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
            >
              {SPORT_TYPES.map((type) => (
                <option key={type} value={type}>{type || 'All'}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">Start Date</label>
            <input
              type="date"
              value={filters.start_date_after || ''}
              onChange={(e) => setFilters({ ...filters, start_date_after: e.target.value || undefined })}
              className="bg-surface-light border border-surface-light text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">End Date</label>
            <input
              type="date"
              value={filters.start_date_before || ''}
              onChange={(e) => setFilters({ ...filters, start_date_before: e.target.value || undefined })}
              className="bg-surface-light border border-surface-light text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">Source</label>
            <select
              value={filters.source || ''}
              onChange={(e) => setFilters({ ...filters, source: e.target.value || undefined })}
              className="bg-surface-light border border-surface-light text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
            >
              {SOURCES.map((src) => (
                <option key={src} value={src}>{src || 'All'}</option>
              ))}
            </select>
          </div>
          <button
            onClick={() => setFilters({})}
            aria-label="Clear all filters"
            className="px-4 py-2 text-sm text-muted hover:text-white border border-surface-light rounded-lg hover:bg-surface-light/50 transition-colors"
          >
            Clear
          </button>
        </div>
      </Card>

      {/* Summary Stats */}
      {displayActivities.length > 0 && (
        <div className="space-y-2">
          <SummaryStatsBar activities={displayActivities} />
          {totalCount !== null && totalCount > displayActivities.length && (
            <p className="text-xs text-muted text-center">
              Showing {displayActivities.length} of {totalCount} activities
            </p>
          )}
        </div>
      )}

      {/* Activity List */}
      <div aria-live="polite">
      {isLoading ? (
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
                  onSelect={() => setSelectedActivityId(selectedActivityId === activity.id ? null : activity.id)}
                />
                {selectedActivityId === activity.id && (
                  <ActivityExpanded activity={activity} activityDetail={activityDetail} />
                )}
              </React.Fragment>
            ))}
          </div>
        )
      ) : (
        <EmptyState
          icon="🏃"
          title="No activities yet"
          description="Connect Strava to sync your first activity, or use the filters above to search existing data."
          action={{ label: 'Go to Settings', href: '/settings' }}
        />
      )}
      </div>

      {/* Load More */}
      {!isLoading && displayActivities.length > 0 && hasMore && (
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
    </div>
  );
}
