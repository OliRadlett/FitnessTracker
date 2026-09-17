'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useQuery } from '@tanstack/react-query';
import { useAuthFetch } from '@/lib/api';
import type { Activity, ActivityStream, ChartData } from '@/lib/api';
import { buildReplay, timeFmt, tourRate, TOUR_PRESETS, type ReplayBuildResult } from '@/lib/replay';
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

  function getStreamValues(streams: ActivityStream[] | undefined, ...types: string[]): number[] {
    if (!streams) return [];
    for (const type of types) {
      const s = streams.find((s) => s.stream_type === type);
      if (!s) continue;
      const data = s.data as Record<string, unknown>;
      const values = (data?.data as number[]) ?? [];
      if (values.length) return values;
    }
    return [];
  }

  // Strava sync writes "watts", FIT imports write "power" — try both spellings.
  function streamInput(
    streams: ActivityStream[] | undefined,
    ...types: string[]
  ): { values: number[]; resolution: number } | undefined {
    for (const type of types) {
      const s = streams?.find((x) => x.stream_type === type);
      if (!s) continue;
      const data = s.data as Record<string, unknown>;
      const values = (data?.data as number[]) ?? [];
      if (values.length) return { values, resolution: s.resolution ?? 1 };
    }
    return undefined;
  }

  // §3.16 side-by-side replay: build a ReplayBuildResult (pure) for each ride.
  function buildReplayFor(
    activity: Activity,
    streams: ActivityStream[] | undefined
  ): ReplayBuildResult | null {
    const velocity = streamInput(streams, 'velocity', 'velocity_smooth');
    if (!velocity || !activity.encoded_polyline) return null;
    const res = buildReplay({
      polyline: activity.encoded_polyline,
      velocity,
      altitude: streamInput(streams, 'altitude'),
      power: streamInput(streams, 'watts', 'power'),
      hr: streamInput(streams, 'heartrate'),
      cadence: streamInput(streams, 'cadence'),
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

  // ── Linked 3D playback (Phase E): one master clock in absolute seconds ──
  // Each ride renders min(t, ownTotal): both start together in real time,
  // shorter rides freeze at their finish while the longer one continues.
  const linkSpan = Math.max(replayA?.totalTime ?? 0, replayB?.totalTime ?? 0);
  const [linked, setLinked] = useState(true);
  const [master, setMaster] = useState({ playing: false, rate: 4, t: 0 });

  // Adopt the tour default once both builds arrive (never yank mid-playback).
  useEffect(() => {
    if (linkSpan > 0) {
      setMaster((m) => (!m.playing && m.t === 0 ? { ...m, rate: tourRate(linkSpan, 60) } : m));
    }
  }, [linkSpan]);

  // Whole-ride presets for the longer ride, deduped for short rides.
  const tourMasterOptions = useMemo(() => {
    const seen = new Set<number>();
    const opts: { label: string; rate: number }[] = [];
    for (const p of TOUR_PRESETS) {
      const r = tourRate(linkSpan, p.secs);
      if (seen.has(r)) continue;
      seen.add(r);
      opts.push({ label: p.label, rate: r });
    }
    return opts;
  }, [linkSpan]);

  useEffect(() => {
    if (!linked || !master.playing) return;
    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(0.5, (now - last) / 1000);
      last = now;
      setMaster((m) => {
        const nt = Math.min(linkSpan, m.t + dt * m.rate);
        if (nt === m.t) return m.playing ? { ...m, playing: false } : m;
        return { ...m, t: nt };
      });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [linked, master.playing, master.rate, linkSpan]);

  const masterScrub = (t: number) =>
    setMaster((m) => ({ ...m, t: Math.max(0, Math.min(linkSpan, t)) }));
  const masterToggle = () =>
    setMaster((m) =>
      m.t >= linkSpan - 0.01 ? { ...m, t: 0, playing: true } : { ...m, playing: !m.playing }
    );
  const masterRate = (rate: number) => setMaster((m) => ({ ...m, rate }));

  const linkFor = {
    t: master.t,
    span: linkSpan,
    rate: master.rate,
    playing: master.playing,
    onScrub: masterScrub,
    onToggle: masterToggle,
    onRate: masterRate,
  };

  const powerA = getStreamValues(streamsA, 'watts', 'power');
  const powerB = getStreamValues(streamsB, 'watts', 'power');
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
                <div className="flex flex-wrap items-center gap-2 rounded border border-surface-light bg-surface/40 p-2">
                  <button
                    onClick={() => setLinked((l) => !l)}
                    aria-pressed={linked}
                    title={linked ? 'Unlink: control each replay separately' : 'Link: one shared clock for both replays'}
                    className={`rounded px-3 py-1 min-h-[44px] text-xs transition-colors ${
                      linked ? 'bg-accent/20 text-accent' : 'text-muted hover:bg-surface-light/40'
                    }`}
                  >
                    {linked ? 'Linked' : 'Independent'}
                  </button>
                  {linked && (
                    <>
                      <button
                        onClick={masterToggle}
                        className="rounded bg-accent px-3 py-1 min-h-[44px] text-sm font-medium text-accent-foreground transition-colors hover:bg-accent/90"
                      >
                        {master.playing ? 'Pause' : 'Play'}
                      </button>
                      <div className="flex items-center gap-1" role="group" aria-label="Playback speed">
                        {tourMasterOptions.map((o) => (
                          <button
                            key={o.label}
                            onClick={() => masterRate(o.rate)}
                            title={`Both rides in ~${o.label} (${o.rate}×)`}
                            className={`rounded px-2 py-1 min-h-[44px] min-w-[44px] text-xs transition-colors ${
                              master.rate === o.rate ? 'bg-accent/20 text-accent' : 'text-muted hover:bg-surface-light/40'
                            }`}
                          >
                            {o.label}
                          </button>
                        ))}
                      </div>
                      <span className="font-mono text-xs tabular-nums text-muted">
                        {timeFmt(master.t)} / {timeFmt(linkSpan)}
                      </span>
                      <input
                        type="range"
                        min={0}
                        max={linkSpan}
                        step={0.1}
                        value={master.t}
                        onChange={(e) => masterScrub(Number(e.target.value))}
                        aria-label="Linked replay scrubbing"
                        className="h-11 min-w-[120px] flex-1 accent-accent"
                      />
                    </>
                  )}
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-muted mb-1">
                      {activityA.name.slice(0, 24)} · {timeFmt(replayA!.totalTime)} · {(replayA!.totalDistance / 1000).toFixed(1)} km
                    </p>
                    <Replay3D name={activityA.name} build={replayA!} polyline={activityA.encoded_polyline ?? undefined} link={linked ? linkFor : null} />
                  </div>
                  <div>
                    <p className="text-xs text-muted mb-1">
                      {activityB.name.slice(0, 24)} · {timeFmt(replayB!.totalTime)} · {(replayB!.totalDistance / 1000).toFixed(1)} km
                    </p>
                    <Replay3D name={activityB.name} build={replayB!} polyline={activityB.encoded_polyline ?? undefined} link={linked ? linkFor : null} />
                  </div>
                </div>
                <p className="text-[11px] text-muted">
                  {linked
                    ? 'Linked playback: both rides share one clock in real time — the shorter ride finishes first.'
                    : 'Two independent fly-throughs — toggle Linked for one shared clock.'}
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
