'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useAuthFetch } from '@/lib/api';
import type { Activity, ActivityDetail } from '@/lib/api';
import type { RouteHistoryResponse } from '@/lib/api/types/routes';
import { buildReplay, type ReplayBuildResult } from '@/lib/replay';
import {
  ALTITUDE_STREAM_TYPES,
  CADENCE_STREAM_TYPES,
  HEARTRATE_STREAM_TYPES,
  POWER_STREAM_TYPES,
  VELOCITY_STREAM_TYPES,
  streamInput,
} from '@/lib/streams';

// three.js stays out of the activities bundle until the Theater opens.
const Replay3D = dynamic(
  () => import('@/components/activities/Replay3D').then((mod) => mod.Replay3D),
  { ssr: false, loading: () => <div className="h-full w-full animate-pulse bg-surface-light/20" /> },
);

/**
 * Full-screen "Theater" for the 3D ride replay (Relive redesign, Phase 1).
 *
 * Portaled to document.body and edge-to-edge so the replay is never crammed
 * into the activity card. The parent keeps the app shell locked/inert while
 * open, mirroring `Modal` (a dialog inside the inert <main> would be dead).
 * Phase 5: ghost racing — pick another ride on the same route.
 */
export function ReplayTheater({
  activity,
  build,
  polyline,
  ftpWatts,
  onClose,
}: {
  activity: Activity;
  build: ReplayBuildResult;
  polyline?: string;
  ftpWatts?: number | null;
  onClose: () => void;
}) {
  const { authFetch, token } = useAuthFetch();
  const [mounted, setMounted] = useState(false);
  const [ghostId, setGhostId] = useState<string | null>(null);

  useEffect(() => setMounted(true), []);

  // Ghost candidates: other rides on the same route.
  const { data: history } = useQuery<RouteHistoryResponse>({
    queryKey: ['route-history', activity.route_id],
    queryFn: () => authFetch<RouteHistoryResponse>(`/api/v1/routes/${activity.route_id}/history`),
    enabled: !!activity.route_id && !!token,
  });
  const ghostCandidates = useMemo(
    () => (history?.rides ?? []).filter((r) => r.activity_id !== activity.id).slice(0, 8),
    [history, activity.id],
  );

  const { data: ghostDetail } = useQuery<ActivityDetail>({
    queryKey: ['activity', ghostId],
    queryFn: () => authFetch<ActivityDetail>(`/api/v1/activities/${ghostId}`),
    enabled: !!ghostId && !!token,
  });

  const ghost = useMemo<{ build: ReplayBuildResult; name: string } | null>(() => {
    const detail = ghostDetail;
    if (!detail?.encoded_polyline) return null;
    const velocity = streamInput(detail.streams, ...VELOCITY_STREAM_TYPES);
    if (!velocity) return null;
    const ride = ghostCandidates.find((r) => r.activity_id === ghostId);
    return {
      build: buildReplay({
        polyline: detail.encoded_polyline,
        velocity,
        altitude: streamInput(detail.streams, ...ALTITUDE_STREAM_TYPES),
        power: streamInput(detail.streams, ...POWER_STREAM_TYPES),
        hr: streamInput(detail.streams, ...HEARTRATE_STREAM_TYPES),
        cadence: streamInput(detail.streams, ...CADENCE_STREAM_TYPES),
        maxSamples: 4000,
      }),
      name: ride ? new Date(ride.date).toLocaleDateString() : 'Ghost',
    };
  }, [ghostDetail, ghostCandidates, ghostId]);

  useEffect(() => {
    const main = document.querySelector('main');
    const prevBody = document.body.style.overflow;
    const prevHtml = document.documentElement.style.overflow;
    const prevMain = main instanceof HTMLElement ? main.style.overflow : null;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    if (main instanceof HTMLElement) main.style.overflow = 'hidden';
    main?.setAttribute('inert', '');
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevBody;
      document.documentElement.style.overflow = prevHtml;
      if (main instanceof HTMLElement) main.style.overflow = prevMain ?? '';
      main?.removeAttribute('inert');
    };
  }, [onClose]);

  if (!mounted) return null;

  const overlay = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`3D Replay — ${activity.name}`}
      className="fixed inset-0 z-[60] flex flex-col bg-background"
    >
      <header className="flex items-center gap-3 border-b border-surface-light px-3 py-2 sm:px-4">
        <span className="text-xs font-medium uppercase tracking-wide text-accent">Relive</span>
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{activity.name}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close 3D replay"
          className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded text-muted transition-colors hover:bg-surface-light/40 hover:text-foreground"
        >
          <X size={20} aria-hidden="true" />
        </button>
      </header>

      {ghostCandidates.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-surface-light px-3 py-2 text-xs sm:px-4">
          <span className="uppercase tracking-wide text-muted">Ghost</span>
          <button
            onClick={() => setGhostId(null)}
            aria-pressed={ghostId === null}
            className={`rounded-full border px-3 py-1 min-h-[36px] transition-colors ${
              ghostId === null ? 'border-accent/50 bg-accent/20 text-accent' : 'border-surface-light text-muted hover:border-accent/30'
            }`}
          >
            Off
          </button>
          {ghostCandidates.map((r) => (
            <button
              key={r.activity_id}
              onClick={() => setGhostId(r.activity_id)}
              aria-pressed={ghostId === r.activity_id}
              title={r.average_power ? `${Math.round(r.average_power)} W avg` : undefined}
              className={`rounded-full border px-3 py-1 min-h-[36px] transition-colors ${
                ghostId === r.activity_id
                  ? 'border-accent/50 bg-accent/20 text-accent'
                  : 'border-surface-light text-muted hover:border-accent/30'
              }`}
            >
              {new Date(r.date).toLocaleDateString()}
              {r.average_power ? ` · ${Math.round(r.average_power)}W` : ''}
            </button>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-2 sm:p-3">
        <Replay3D
          name={activity.name}
          build={build}
          polyline={polyline}
          ftpWatts={ftpWatts}
          startDate={activity.start_date}
          ghost={ghost}
          weather={{
            conditions: activity.weather_conditions,
            temperature: activity.weather_temperature,
            windSpeedKmh: activity.weather_wind_speed_kmh,
            windDirection: activity.weather_wind_direction,
            precipitationMm: activity.weather_precipitation_mm,
          }}
          canvasHeightClass="h-[68dvh]"
          theater
        />
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}
