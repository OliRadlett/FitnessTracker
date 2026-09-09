'use client';

import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useQuery } from '@tanstack/react-query';
import { useAuthFetch } from '@/lib/api';
import type { Activity, ActivityStream, ChartData } from '@/lib/api';
import { buildReplay, timeFmt, type ReplayBuildResult } from '@/lib/replay';
import { Chart } from '@/components/charts/Chart';
import { Modal, ModalHeader } from '@/components/ui/Modal';
import { formatDuration, formatDistance } from '@/lib/utils';

// Lazy-loaded: three.js stays out of the modal's (and first) bundle unless the
// user opens the 3D view (§3.16 side-by-side replay).
const Replay3D = dynamic(
  () => import('@/components/activities/Replay3D').then((mod) => mod.Replay3D),
  { ssr: false, loading: () => <div className="h-[300px] animate-pulse bg-surface-light/20 rounded" /> }
);

export function CompareActivitiesModal({
  activityA,
  activityB,
  onClose,
}: {
  activityA: Activity;
  activityB: Activity;
  onClose: () => void;
}) {
  const { authFetch, token } = useAuthFetch();

  const { data: streamsA, isLoading: loadingA } = useQuery<ActivityStream[]>({
    queryKey: ['activity-streams', activityA.id],
    queryFn: () => authFetch<ActivityStream[]>(`/api/v1/activities/${activityA.id}/streams`),
    enabled: !!token,
  });

  const { data: streamsB, isLoading: loadingB } = useQuery<ActivityStream[]>({
    queryKey: ['activity-streams', activityB.id],
    queryFn: () => authFetch<ActivityStream[]>(`/api/v1/activities/${activityB.id}/streams`),
    enabled: !!token,
  });

  const isLoading = loadingA || loadingB;

  function getStreamValues(streams: ActivityStream[] | undefined, type: string): number[] {
    if (!streams) return [];
    const s = streams.find((s) => s.stream_type === type);
    if (!s) return [];
    const data = s.data as Record<string, unknown>;
    return (data?.data as number[]) ?? [];
  }

  function streamInput(
    streams: ActivityStream[] | undefined,
    type: string
  ): { values: number[]; resolution: number } | undefined {
    const s = streams?.find((x) => x.stream_type === type);
    if (!s) return undefined;
    const data = s.data as Record<string, unknown>;
    const values = (data?.data as number[]) ?? [];
    return values.length ? { values, resolution: s.resolution ?? 1 } : undefined;
  }

  // §3.16 side-by-side replay: build a ReplayBuildResult (pure) for each ride.
  function buildReplayFor(
    activity: Activity,
    streams: ActivityStream[] | undefined
  ): ReplayBuildResult | null {
    const velocity = streamInput(streams, 'velocity');
    if (!velocity || !activity.encoded_polyline) return null;
    const res = buildReplay({
      polyline: activity.encoded_polyline,
      velocity,
      altitude: streamInput(streams, 'altitude'),
      power: streamInput(streams, 'watts'),
      hr: streamInput(streams, 'heartrate'),
      maxSamples: 800,
    });
    return res;
  }

  const replayA = useMemo(() => buildReplayFor(activityA, streamsA), [activityA, streamsA]);
  const replayB = useMemo(() => buildReplayFor(activityB, streamsB), [activityB, streamsB]);
  const canCompare3d = replayA !== null && replayB !== null;
  const [view, setView] = useState<'charts' | '3d'>('charts');
  // Auto-switch to the 3D tab once both builds are ready (and hide it if not).
  const show3d = canCompare3d;

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

        {/* Activity names (stacked on phones) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
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

          {show3d && (
            <div className="flex items-center gap-1 mb-4 text-xs uppercase tracking-wide">
              <button
                onClick={() => setView('charts')}
                className={`px-3 py-1 rounded ${view === 'charts' ? 'bg-accent text-accent-foreground' : 'text-muted hover:bg-surface-light/40'}`}
              >
                Charts
              </button>
              <button
                onClick={() => setView('3d')}
                className={`px-3 py-1 rounded ${view === '3d' ? 'bg-accent text-accent-foreground' : 'text-muted hover:bg-surface-light/40'}`}
              >
                3D Side-by-Side
              </button>
            </div>
          )}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-accent" />
          </div>
        ) : (
          <div className="space-y-6">
            {view === '3d' ? (
              <div className="space-y-4">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-muted mb-1">
                      {activityA.name.slice(0, 24)} · {timeFmt(replayA!.totalTime)} · {(replayA!.totalDistance / 1000).toFixed(1)} km
                    </p>
                    <Replay3D name={activityA.name} build={replayA!} />
                  </div>
                  <div>
                    <p className="text-xs text-muted mb-1">
                      {activityB.name.slice(0, 24)} · {timeFmt(replayB!.totalTime)} · {(replayB!.totalDistance / 1000).toFixed(1)} km
                    </p>
                    <Replay3D name={activityB.name} build={replayB!} />
                  </div>
                </div>
                <p className="text-[11px] text-muted">
                  Two independent fly-throughs (§3.16). Synced-playback across
                  both is a documented follow-up.
                </p>
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
                        <td className="text-right text-muted py-2 px-4">{row.a}</td>
                        <td className="text-right text-muted py-2 px-4">{row.b}</td>
                        <td className={`text-right py-2 pl-4 font-medium ${
                          row.positive === null ? 'text-muted' : row.positive ? 'text-positive' : 'text-warning'
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
        </div>
        )}
    </Modal>
  );
}
