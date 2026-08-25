'use client';

import React, { useState, useMemo, useRef, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthFetch } from '@/lib/api';
import type { Activity, ActivityDetail, ChartData, ActivityFilters, ActivitySource, ActivityStream, RideAnalysis } from '@/lib/api';
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
import { Modal, ModalHeader } from '@/components/ui/Modal';
import { ChartCard } from '@/components/charts/ChartCard';
import { SkeletonRow } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatDuration, formatDistance } from '@/lib/utils';
import { ProviderIcon, PROVIDER_COLORS } from '@/components/ui/ProviderBadge';
import { usePageTitle } from '@/lib/usePageTitle';
import { STRENGTH_TYPES } from '@/lib/sportUtils';

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
  showCompareCheckbox,
  isCompareSelected,
  onToggleCompare,
}: {
  activity: Activity;
  isSelected: boolean;
  onSelect: () => void;
  showCompareCheckbox?: boolean;
  isCompareSelected?: boolean;
  onToggleCompare?: () => void;
}) {
  const isStrength = STRENGTH_TYPES.includes(activity.sport_type);

  return (
    <Card
      onClick={onSelect}
      className={isSelected ? 'border-accent/50' : ''}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          {showCompareCheckbox && (
            <label
              className="flex items-center"
              onClick={(e) => e.stopPropagation()}
              title="Select for comparison"
            >
              <input
                type="checkbox"
                checked={isCompareSelected}
                onChange={onToggleCompare}
                className="w-4 h-4 rounded border-surface-light bg-surface-light text-accent focus:ring-accent focus:ring-offset-0 cursor-pointer"
              />
            </label>
          )}
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
                <span className="ml-2 text-accent">{'\u{1F4CD}'} {activity.route_name}</span>
              )}
              <WeatherBadge
                temperature={activity.weather_temperature ?? null}
                conditions={activity.weather_conditions ?? null}
                wind_speed_kmh={activity.weather_wind_speed_kmh ?? null}
              />
            </p>
          </div>
        </div>
        <div className="flex items-center flex-wrap gap-6 text-right">
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

// ── Compare Activities Modal ─────────────────────────────────────────────────

function CompareActivitiesModal({
  activityA,
  activityB,
  onClose,
}: {
  activityA: Activity;
  activityB: Activity;
  onClose: () => void;
}) {
  const { authFetch } = useAuthFetch();

  const { data: streamsA, isLoading: loadingA } = useQuery<ActivityStream[]>({
    queryKey: ['activity-streams', activityA.id],
    queryFn: () => authFetch<ActivityStream[]>(`/api/v1/activities/${activityA.id}/streams`),
  });

  const { data: streamsB, isLoading: loadingB } = useQuery<ActivityStream[]>({
    queryKey: ['activity-streams', activityB.id],
    queryFn: () => authFetch<ActivityStream[]>(`/api/v1/activities/${activityB.id}/streams`),
  });

  const isLoading = loadingA || loadingB;

  function getStreamValues(streams: ActivityStream[] | undefined, type: string): number[] {
    if (!streams) return [];
    const s = streams.find((s) => s.stream_type === type);
    if (!s) return [];
    const data = s.data as Record<string, unknown>;
    return (data?.data as number[]) ?? [];
  }

  const powerA = getStreamValues(streamsA, 'power');
  const powerB = getStreamValues(streamsB, 'power');
  const hrA = getStreamValues(streamsA, 'heartrate');
  const hrB = getStreamValues(streamsB, 'heartrate');

  // Build power overlay chart
  const powerChart: ChartData | null = (powerA.length > 0 || powerB.length > 0)
    ? {
        chart_type: 'line',
        title: 'Power Overlay',
        labels: Array.from({ length: Math.max(powerA.length, powerB.length) }, (_, i) => String(i)),
        x_label: 'Sample',
        y_label: 'Power (W)',
        series: [
          ...(powerA.length > 0 ? [{ name: activityA.name.slice(0, 20), data: powerA, color: '#3b82f6' }] : []),
          ...(powerB.length > 0 ? [{ name: activityB.name.slice(0, 20), data: powerB, color: '#f59e0b' }] : []),
        ],
      }
    : null;

  // Build HR overlay chart
  const hrChart: ChartData | null = (hrA.length > 0 || hrB.length > 0)
    ? {
        chart_type: 'line',
        title: 'Heart Rate Overlay',
        labels: Array.from({ length: Math.max(hrA.length, hrB.length) }, (_, i) => String(i)),
        x_label: 'Sample',
        y_label: 'HR (bpm)',
        series: [
          ...(hrA.length > 0 ? [{ name: activityA.name.slice(0, 20), data: hrA, color: '#ef4444' }] : []),
          ...(hrB.length > 0 ? [{ name: activityB.name.slice(0, 20), data: hrB, color: '#ec4899' }] : []),
        ],
      }
    : null;

  // Stats delta table
  const deltas = useMemo(() => {
    const rows: { label: string; a: string; b: string; delta: string; positive: boolean | null }[] = [];

    const durA = activityA.duration_seconds ?? 0;
    const durB = activityB.duration_seconds ?? 0;
    const durDelta = durB - durA;
    rows.push({
      label: 'Duration',
      a: formatDuration(durA),
      b: formatDuration(durB),
      delta: `${durDelta >= 0 ? '+' : ''}${formatDuration(Math.abs(durDelta))}`,
      positive: durDelta === 0 ? null : durDelta > 0,
    });

    const distA = activityA.distance_meters ?? 0;
    const distB = activityB.distance_meters ?? 0;
    const distDelta = distB - distA;
    rows.push({
      label: 'Distance',
      a: formatDistance(distA),
      b: formatDistance(distB),
      delta: `${distDelta >= 0 ? '+' : ''}${formatDistance(Math.abs(distDelta))}`,
      positive: distDelta === 0 ? null : distDelta > 0,
    });

    const powA = activityA.average_power ?? 0;
    const powB = activityB.average_power ?? 0;
    const powDelta = powB - powA;
    rows.push({
      label: 'Avg Power',
      a: `${powA} W`,
      b: `${powB} W`,
      delta: `${powDelta >= 0 ? '+' : ''}${powDelta} W`,
      positive: powDelta === 0 ? null : powDelta > 0,
    });

    const tssA = activityA.tss ?? 0;
    const tssB = activityB.tss ?? 0;
    const tssDelta = tssB - tssA;
    rows.push({
      label: 'TSS',
      a: String(Math.round(tssA)),
      b: String(Math.round(tssB)),
      delta: `${tssDelta >= 0 ? '+' : ''}${Math.round(Math.abs(tssDelta))}`,
      positive: tssDelta === 0 ? null : tssDelta > 0,
    });

    const hrAvgA = activityA.average_heartrate ?? 0;
    const hrAvgB = activityB.average_heartrate ?? 0;
    const hrDelta = hrAvgB - hrAvgA;
    rows.push({
      label: 'Avg HR',
      a: hrAvgA ? `${hrAvgA} bpm` : '\u2014',
      b: hrAvgB ? `${hrAvgB} bpm` : '\u2014',
      delta: hrAvgA && hrAvgB ? `${hrDelta >= 0 ? '+' : ''}${hrDelta} bpm` : '\u2014',
      positive: hrDelta === 0 ? null : hrDelta > 0,
    });

    return rows;
  }, [activityA, activityB]);

  return (
    <Modal open onClose={onClose} size="xl" aria-label="Compare Activities">
      <ModalHeader title="Compare Activities" onClose={onClose} />

        {/* Activity names */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="bg-surface-light/30 rounded-lg p-3">
            <p className="text-xs text-muted mb-1">Activity A</p>
            <p className="text-sm font-medium text-blue-400 truncate">{activityA.name}</p>
            <p className="text-xs text-muted">{new Date(activityA.start_date).toLocaleDateString()}</p>
          </div>
          <div className="bg-surface-light/30 rounded-lg p-3">
            <p className="text-xs text-muted mb-1">Activity B</p>
            <p className="text-sm font-medium text-amber-400 truncate">{activityB.name}</p>
            <p className="text-xs text-muted">{new Date(activityB.start_date).toLocaleDateString()}</p>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-accent" />
          </div>
        ) : (
          <>
            {/* Stream charts */}
            {powerChart && (
              <div className="mb-6">
                <Chart data={powerChart} height={250} />
              </div>
            )}
            {hrChart && (
              <div className="mb-6">
                <Chart data={hrChart} height={250} />
              </div>
            )}
            {!powerChart && !hrChart && (
              <p className="text-muted text-sm text-center py-8">No stream data available for comparison</p>
            )}

            {/* Stats delta table */}
            <div className="mt-4">
              <h3 className="text-sm font-semibold text-white mb-3">Stats Comparison</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-surface-light/50">
                      <th className="text-left text-muted py-2 pr-4">Metric</th>
                      <th className="text-right text-blue-400 py-2 px-4">A</th>
                      <th className="text-right text-amber-400 py-2 px-4">B</th>
                      <th className="text-right text-muted py-2 pl-4">{'\u0394'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deltas.map((row) => (
                      <tr key={row.label} className="border-b border-surface-light/20">
                        <td className="py-2 pr-4 text-white">{row.label}</td>
                        <td className="text-right text-slate-300 py-2 px-4">{row.a}</td>
                        <td className="text-right text-slate-300 py-2 px-4">{row.b}</td>
                        <td className={`text-right py-2 pl-4 font-medium ${
                          row.positive === null ? 'text-muted' : row.positive ? 'text-green-400' : 'text-red-400'
                        }`}>
                          {row.delta}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
    </Modal>
  );
}

// ── Stats View ───────────────────────────────────────────────────────────────

function StatsView({ activities }: { activities: Activity[] }) {
  // Monthly distance bars (last 6 months)
  const monthlyDistanceChart: ChartData | null = useMemo(() => {
    if (activities.length === 0) return null;
    const now = new Date();
    const months: { key: string; label: string; distance: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
      months.push({ key, label, distance: 0 });
    }
    for (const a of activities) {
      if (STRENGTH_TYPES.includes(a.sport_type)) continue;
      const d = new Date(a.start_date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const month = months.find((m) => m.key === key);
      if (month) month.distance += a.distance_meters ?? 0;
    }
    return {
      chart_type: 'bar',
      title: 'Monthly Distance',
      labels: months.map((m) => m.label),
      x_label: 'Month',
      y_label: 'Distance (km)',
      series: [{ name: 'Distance', data: months.map((m) => Math.round(m.distance / 1000 * 10) / 10) }],
    };
  }, [activities]);

  // Sport breakdown pie
  const sportPieChart: ChartData | null = useMemo(() => {
    if (activities.length === 0) return null;
    const counts = new Map<string, number>();
    for (const a of activities) {
      counts.set(a.sport_type, (counts.get(a.sport_type) ?? 0) + 1);
    }
    const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
    return {
      chart_type: 'pie',
      title: 'Sport Breakdown',
      labels: sorted.map(([type]) => type),
      series: [{ name: 'Activities', data: sorted.map(([, count]) => count) }],
    };
  }, [activities]);

  // Weekly TSS trend (last 12 weeks)
  const weeklyTssChart: ChartData | null = useMemo(() => {
    if (activities.length === 0) return null;
    const now = new Date();
    const weeks: { key: string; label: string; tss: number }[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i * 7);
      const weekKey = getISOWeek(d);
      const label = `W${weekKey.split('-W')[1]}`;
      weeks.push({ key: weekKey, label, tss: 0 });
    }
    // Deduplicate by key
    const uniqueWeeks = weeks.filter((w, i, arr) => arr.findIndex((x) => x.key === w.key) === i);
    for (const a of activities) {
      const weekKey = getISOWeek(new Date(a.start_date));
      const week = uniqueWeeks.find((w) => w.key === weekKey);
      if (week) week.tss += a.tss ?? 0;
    }
    return {
      chart_type: 'area',
      title: 'Weekly TSS Trend',
      labels: uniqueWeeks.map((w) => w.label),
      x_label: 'Week',
      y_label: 'TSS',
      series: [{ name: 'TSS', data: uniqueWeeks.map((w) => Math.round(w.tss)) }],
    };
  }, [activities]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <ChartCard
        title="Monthly Distance"
        data={monthlyDistanceChart}
        emptyMessage="No activity data"
        height={280}
      />
      <ChartCard
        title="Sport Breakdown"
        data={sportPieChart}
        emptyMessage="No activity data"
        height={280}
      />
      <div className="lg:col-span-2">
        <ChartCard
          title="Weekly TSS Trend"
          data={weeklyTssChart}
          emptyMessage="No TSS data"
          height={280}
        />
      </div>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function ActivitiesPage() {
  usePageTitle('Activities');
  const { authFetch, authFetchWithHeaders, authUpload } = useAuthFetch();
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<ActivityFilters>({});
  const [selectedActivityId, setSelectedActivityId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'week' | 'stats'>('list');
  const [allActivities, setAllActivities] = useState<Activity[] | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const PAGE_SIZE = 50;

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

  // Fetch a larger dataset for stats view (last 6 months, up to 200 activities)
  const sixMonthsAgo = useMemo(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 6);
    return d.toISOString().split('T')[0];
  }, []);

  const { data: statsActivities, isLoading: statsLoading } = useQuery<Activity[]>({
    queryKey: ['activities-stats'],
    queryFn: () => authFetch<Activity[]>(`/api/v1/activities?start_date_after=${sixMonthsAgo}&limit=200&sort_by=start_date&sort_order=desc`),
    enabled: viewMode === 'stats',
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
              onSelect={() => setSelectedActivityId(selectedActivityId === activity.id ? null : activity.id)}
              showCompareCheckbox={viewMode === 'list'}
              isCompareSelected={selectedForComparison.has(activity.id)}
              onToggleCompare={() => toggleCompare(activity.id)}
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
          <button
            onClick={() => setViewMode('stats')}
            role="tab"
            aria-selected={viewMode === 'stats'}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              viewMode === 'stats' ? 'bg-accent text-white' : 'text-muted hover:text-white'
            }`}
          >
            Stats
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
              '\u{1F4C4}'
            )}
            {importLoading === 'gpx' ? 'Importing\u2026' : 'Import GPX'}
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
              '\u231A'
            )}
            {importLoading === 'fit' ? 'Importing\u2026' : 'Import FIT'}
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
              {importMessage.type === 'success' ? '\u2713' : '\u2717'} {importMessage.text}
            </span>
          )}
        </div>
      </Card>

      {/* Filter Bar */}
      <Card>
        <div className="flex flex-wrap gap-4 items-end">
          {/* Text search */}
          <div className="flex-1 min-w-[180px]">
            <label className="block text-xs text-muted mb-1">Search</label>
            <input
              type="text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Search activities..."
              className="w-full bg-surface-light border border-surface-light text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent placeholder:text-muted/60"
            />
          </div>
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
          <div>
            <label className="block text-xs text-muted mb-1">Sort</label>
            <select
              value={sortIndex}
              onChange={(e) => setSortIndex(parseInt(e.target.value, 10))}
              className="bg-surface-light border border-surface-light text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
            >
              {SORT_OPTIONS.map((opt, i) => (
                <option key={i} value={i}>{opt.label}</option>
              ))}
            </select>
          </div>
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className={`px-3 py-2 text-sm border rounded-lg transition-colors ${
              showAdvanced
                ? 'bg-accent/20 text-accent border-accent/30'
                : 'text-muted hover:text-white border-surface-light hover:bg-surface-light/50'
            }`}
          >
            {showAdvanced ? '\u25B2' : '\u25BC'} Filters
          </button>
          <button
            onClick={clearAllFilters}
            aria-label="Clear all filters"
            className="px-4 py-2 text-sm text-muted hover:text-white border border-surface-light rounded-lg hover:bg-surface-light/50 transition-colors"
          >
            Clear
          </button>
        </div>

        {/* Advanced filters row */}
        {showAdvanced && (
          <div className="flex flex-wrap gap-4 items-end mt-4 pt-4 border-t border-surface-light/30">
            <div>
              <label className="block text-xs text-muted mb-1">Min Distance (km)</label>
              <input
                type="number"
                min="0"
                step="0.1"
                value={advMinDist}
                onChange={(e) => setAdvMinDist(e.target.value)}
                placeholder="0"
                className="w-24 bg-surface-light border border-surface-light text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent placeholder:text-muted/60"
              />
            </div>
            <div>
              <label className="block text-xs text-muted mb-1">Max Distance (km)</label>
              <input
                type="number"
                min="0"
                step="0.1"
                value={advMaxDist}
                onChange={(e) => setAdvMaxDist(e.target.value)}
                placeholder="999"
                className="w-24 bg-surface-light border border-surface-light text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent placeholder:text-muted/60"
              />
            </div>
            <div>
              <label className="block text-xs text-muted mb-1">Min Duration (min)</label>
              <input
                type="number"
                min="0"
                step="1"
                value={advMinDur}
                onChange={(e) => setAdvMinDur(e.target.value)}
                placeholder="0"
                className="w-24 bg-surface-light border border-surface-light text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent placeholder:text-muted/60"
              />
            </div>
            <div>
              <label className="block text-xs text-muted mb-1">Max Duration (min)</label>
              <input
                type="number"
                min="0"
                step="1"
                value={advMaxDur}
                onChange={(e) => setAdvMaxDur(e.target.value)}
                placeholder="999"
                className="w-24 bg-surface-light border border-surface-light text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent placeholder:text-muted/60"
              />
            </div>
            <div>
              <label className="block text-xs text-muted mb-1">Min TSS</label>
              <input
                type="number"
                min="0"
                step="1"
                value={advMinTss}
                onChange={(e) => setAdvMinTss(e.target.value)}
                placeholder="0"
                className="w-24 bg-surface-light border border-surface-light text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent placeholder:text-muted/60"
              />
            </div>
            <div>
              <label className="block text-xs text-muted mb-1">Max TSS</label>
              <input
                type="number"
                min="0"
                step="1"
                value={advMaxTss}
                onChange={(e) => setAdvMaxTss(e.target.value)}
                placeholder="999"
                className="w-24 bg-surface-light border border-surface-light text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent placeholder:text-muted/60"
              />
            </div>
          </div>
        )}
      </Card>

      {/* Summary Stats */}
      {viewMode !== 'stats' && displayActivities.length > 0 && (
        <div className="space-y-2">
          <SummaryStatsBar activities={displayActivities} />
          {totalCount !== null && totalCount > displayActivities.length && (
            <p className="text-xs text-muted text-center">
              Showing {displayActivities.length} of {totalCount} activities
            </p>
          )}
        </div>
      )}

      {/* Activity List / Stats */}
      <div aria-live="polite">
      {viewMode === 'stats' ? (
        statsLoading ? (
          <div className="space-y-3" aria-label="Loading stats">
            {Array.from({ length: 3 }).map((_, i) => (
              <SkeletonRow key={i} />
            ))}
          </div>
        ) : (
          <StatsView activities={statsActivities ?? []} />
        )
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
                  onSelect={() => setSelectedActivityId(selectedActivityId === activity.id ? null : activity.id)}
                  showCompareCheckbox={viewMode === 'list'}
                  isCompareSelected={selectedForComparison.has(activity.id)}
                  onToggleCompare={() => toggleCompare(activity.id)}
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
          icon={"\u{1F3C3}"}
          title="No activities yet"
          description="Connect Strava to sync your first activity, or use the filters above to search existing data."
          action={{ label: 'Go to Settings', href: '/settings' }}
        />
      )}
      </div>

      {/* Load More */}
      {!isLoading && viewMode !== 'stats' && displayActivities.length > 0 && hasMore && (
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
