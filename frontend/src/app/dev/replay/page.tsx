'use client';

/**
 * Offline 3D-theater test harness (Relive dev tool).
 *
 * Renders the real Replay3D with fixtures dumped from the prod DB — no auth,
 * no backend. Open /fittrack/dev/replay. Fixtures live in
 * `public/dev-fixtures/` (gitignored). See `docs/RUNNING.md`.
 */

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { buildReplay, type ReplayBuildResult } from '@/lib/replay';
import {
  ALTITUDE_STREAM_TYPES,
  CADENCE_STREAM_TYPES,
  HEARTRATE_STREAM_TYPES,
  POWER_STREAM_TYPES,
  VELOCITY_STREAM_TYPES,
  streamInput,
} from '@/lib/streams';
import type { ActivityStream } from '@/lib/api';

const Replay3D = dynamic(
  () => import('@/components/activities/Replay3D').then((mod) => mod.Replay3D),
  { ssr: false, loading: () => <div className="h-full w-full animate-pulse bg-surface-light/20" /> },
);

interface Fixture {
  id: string;
  name: string;
  start_date: string;
  distance_meters: number;
  encoded_polyline: string;
  streams: ActivityStream[];
}

const FIXTURE_NAMES = ['act1', 'act2'];

function buildFrom(f: Fixture): ReplayBuildResult {
  return buildReplay({
    polyline: f.encoded_polyline,
    velocity: streamInput(f.streams, ...VELOCITY_STREAM_TYPES),
    altitude: streamInput(f.streams, ...ALTITUDE_STREAM_TYPES),
    power: streamInput(f.streams, ...POWER_STREAM_TYPES),
    hr: streamInput(f.streams, ...HEARTRATE_STREAM_TYPES),
    cadence: streamInput(f.streams, ...CADENCE_STREAM_TYPES),
    maxSamples: 4000,
  });
}

export default function DevReplayPage() {
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [idx, setIdx] = useState(0);
  const [ghostIdx, setGhostIdx] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    Promise.all(
      FIXTURE_NAMES.map((n) =>
        fetch(`/fittrack/dev-fixtures/${n}.json`).then((r) => {
          if (!r.ok) throw new Error(`${n}: HTTP ${r.status}`);
          return r.json();
        }),
      ),
    )
      .then((fs) => setFixtures(fs as Fixture[]))
      .catch((e) => setErr(String(e)));
  }, []);

  const build = useMemo(() => (fixtures[idx] ? buildFrom(fixtures[idx]) : null), [fixtures, idx]);
  const ghost = useMemo(
    () =>
      ghostIdx != null && fixtures[ghostIdx]
        ? { build: buildFrom(fixtures[ghostIdx]), name: fixtures[ghostIdx].name }
        : null,
    [fixtures, ghostIdx],
  );

  if (err) return <div className="p-6 text-sm text-warning">Fixture load failed — {err}</div>;
  if (!build || !fixtures[idx]) return <div className="p-6 text-sm text-muted">Loading fixtures…</div>;

  const btn = (active: boolean) =>
    `rounded-full border px-3 py-1 text-xs ${
      active ? 'border-accent/50 bg-accent/20 text-accent' : 'border-surface-light text-muted'
    }`;

  return (
    <div className="fixed inset-0 flex flex-col bg-background">
      <div className="flex flex-wrap items-center gap-2 border-b border-surface-light p-2 text-xs">
        <span className="uppercase tracking-wide text-muted">Ride</span>
        {fixtures.map((f, i) => (
          <button key={f.id} className={btn(i === idx)} onClick={() => setIdx(i)}>
            {(f.distance_meters / 1000).toFixed(1)} km
          </button>
        ))}
        <span className="ml-2 uppercase tracking-wide text-muted">Ghost</span>
        <button className={btn(ghostIdx === null)} onClick={() => setGhostIdx(null)}>
          Off
        </button>
        {fixtures.map((f, i) => (
          <button key={f.id} className={btn(ghostIdx === i)} onClick={() => setGhostIdx(i)}>
            {(f.distance_meters / 1000).toFixed(1)} km
          </button>
        ))}
        <span className="ml-auto text-muted">offline fixtures · no auth</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <Replay3D
          name={fixtures[idx].name}
          build={build}
          polyline={fixtures[idx].encoded_polyline}
          startDate={fixtures[idx].start_date}
          ghost={ghost}
          canvasHeightClass="h-[calc(100dvh-7rem)]"
          theater
        />
      </div>
    </div>
  );
}
