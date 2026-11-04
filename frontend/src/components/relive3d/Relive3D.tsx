'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';

import {
  POSES,
  formatClock,
  formatDate,
  formatDistance,
  formatDuration,
  indexAtTime,
  poseTime,
  type GhostOption,
  type PoseName,
  type Ride,
} from '@/lib/relive3d/types';
import { claimMapOpen } from '@/lib/relive3d/mapBudget';
import { ReliveStory } from './ReliveStory';
import { Google3DWorld } from './world/google3dWorld';
import styles from './Relive3D.module.css';

const POSTER_W = 1000;
const POSTER_H = 700;
const POSTER_PAD = 54;

interface Props {
  ride: Ride;
  mapBudget?: { allowed: boolean; used: number; limit: number };
  ghost?: Ride | null;
  /** Past rides on the same route, offered as ghosts. Hidden when empty. */
  ghosts?: GhostOption[];
  ghostId?: string | null;
  onGhostChange?: (id: string | null) => void;
  /** True while the selected ghost's streams are being fetched. */
  ghostLoading?: boolean;
  /** Where the title card's back link goes. Omitted in the dev harness. */
  backHref?: string;
  /**
   * Small label above the ride name. Callers pass the place/sport; the viewer
   * cannot infer it from the ride, and hard-coding a fixture name here leaked
   * "Lake Geneva" onto every production ride.
   */
  eyebrowLabel?: string;
}

function weatherLine(ride: Ride): string {
  const weather = ride.weather;
  return [
    weather.conditions ?? '—',
    weather.temperature_c != null ? `${weather.temperature_c.toFixed(1)}°C` : null,
    weather.wind_speed_kmh != null
      ? `wind ${weather.wind_speed_kmh.toFixed(1)} km/h`
      : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

export function Relive3D({
  ride,
  mapBudget,
  ghost,
  ghosts,
  ghostId,
  onGhostChange,
  ghostLoading,
  backHref,
  eyebrowLabel,
}: Props) {
  const t0 = ride.streams.t[0];
  const t1 = ride.streams.t[ride.streams.t.length - 1];
  const [t, setT] = useState(() => poseTime(ride, 'overview'));
  const [playing, setPlaying] = useState(false);
  const [pose, setPose] = useState<PoseName>('overview');
  const [speed, setSpeed] = useState(120);
  const [dataVisible, setDataVisible] = useState(true);
  const [follow, setFollow] = useState(false);
  const tRef = useRef(t);
  const mapRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<Google3DWorld | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapBudgetInfo, setMapBudgetInfo] = useState<{
    used: number;
    limit: number;
  } | null>(null);

  useEffect(() => {
    tRef.current = t;
  }, [t]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
      last = now;
      const next = Math.min(t1, tRef.current + dt * speed);
      tRef.current = next;
      setT(next);
      if (next >= t1) {
        setPlaying(false);
        return;
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, t1]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement) return;
      const index = Number(event.key) - 1;
      if (index >= 0 && index < POSES.length) {
        const next = POSES[index].id;
        setPose(next);
        setT(poseTime(ride, next));
        setPlaying(false);
        return;
      }
      if (event.key.toLowerCase() === 'p') {
        setPlaying((value) => !value);
      }
      if (event.key.toLowerCase() === 'd') {
        setDataVisible((value) => !value);
      }
      if (event.key.toLowerCase() === 'f') {
        setFollow((value) => !value);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ride]);

  useEffect(() => {
    const container = mapRef.current;
    if (!container) return;
    const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    if (!key) {
      setMapError('Google Maps key not configured');
      return;
    }
    const budget = mapBudget ?? claimMapOpen();
    setMapBudgetInfo({ used: budget.used, limit: budget.limit });
    if (!budget.allowed) {
      setMapError('monthly 3D map cap reached');
      return;
    }
    let disposed = false;
    const world = new Google3DWorld(container, ride);
    worldRef.current = world;
    world
      .mount()
      .then(() => {
        if (disposed) {
          world.dispose();
          return;
        }
        setMapReady(true);
        setMapError(null);
        world.setPose(pose, false);
        world.setRider(indexAtTime(ride, tRef.current));
        world.setFollow(follow);
      })
      .catch((error: unknown) => {
        if (disposed) return;
        setMapError(
          error instanceof Error ? error.message : '3D map unavailable',
        );
        world.dispose();
        worldRef.current = null;
      });
    return () => {
      disposed = true;
      worldRef.current = null;
      world.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ride]);

  useEffect(() => {
    if (!mapReady) return;
    worldRef.current?.setPose(pose, true);
  }, [pose, mapReady]);

  useEffect(() => {
    if (!mapReady) return;
    worldRef.current?.setRider(indexAtTime(ride, t));
  }, [ride, t, mapReady]);

  useEffect(() => {
    if (!mapReady) return;
    worldRef.current?.setFollow(follow);
  }, [follow, mapReady]);

  useEffect(() => {
    if (!mapReady) return;
    const world = worldRef.current;
    if (!world) return;
    if (!ghost) {
      world.setGhost(null);
      return;
    }
    const i = indexAtTime(ghost, t);
    world.setGhost({
      lat: ghost.streams.lat[i],
      lng: ghost.streams.lng[i],
      alt: ghost.streams.alt[i],
    });
  }, [ghost, t, mapReady]);

  const index = indexAtTime(ride, t);
  const ghostIndex = ghost ? indexAtTime(ghost, t) : -1;
  const n = ride.streams.t.length;

  const poster = useMemo(() => {
    const { minLat, maxLat, minLng, maxLng } = ride.bounds;
    const latSpan = Math.max(1e-6, maxLat - minLat);
    const lngSpan = Math.max(1e-6, maxLng - minLng);
    const scale = Math.min(
      (POSTER_W - POSTER_PAD * 2) / lngSpan,
      (POSTER_H - POSTER_PAD * 2) / latSpan,
    );
    const offsetX = (POSTER_W - lngSpan * scale) / 2;
    const offsetY = (POSTER_H - latSpan * scale) / 2;
    const px = (lng: number) => offsetX + (lng - minLng) * scale;
    const py = (lat: number) => POSTER_H - (offsetY + (lat - minLat) * scale);

    const step = Math.max(1, Math.ceil(n / 1200));
    const points: string[] = [];
    for (let i = 0; i < n; i += step) {
      points.push(
        `${i === 0 ? 'M' : 'L'}${px(ride.streams.lng[i]).toFixed(1)},${py(
          ride.streams.lat[i],
        ).toFixed(1)}`,
      );
    }
    const last = n - 1;
    points.push(
      `L${px(ride.streams.lng[last]).toFixed(1)},${py(
        ride.streams.lat[last],
      ).toFixed(1)}`,
    );
    return { path: points.join(' '), px, py };
  }, [ride, n]);

  const riderX = poster.px(ride.streams.lng[index]);
  const riderY = poster.py(ride.streams.lat[index]);
  const poseKey = pose === 'close' ? 'climb' : pose;
  const poseIdx = ride.keyPoints[poseKey] ?? 0;
  const poseX = poster.px(ride.streams.lng[poseIdx]);
  const poseY = poster.py(ride.streams.lat[poseIdx]);
  const startX = poster.px(ride.streams.lng[0]);
  const startY = poster.py(ride.streams.lat[0]);
  const endX = poster.px(ride.streams.lng[n - 1]);
  const endY = poster.py(ride.streams.lat[n - 1]);

  const selectPose = (next: PoseName) => {
    setPose(next);
    setT(poseTime(ride, next));
    setPlaying(false);
  };

  const eyebrow = eyebrowLabel ?? 'RELIVE';

  return (
    <div className={styles.root}>
      <div ref={mapRef} className={styles.map} aria-hidden="true" />
      {!mapReady && (
        <div className={styles.poster}>
          <svg
          viewBox={`0 0 ${POSTER_W} ${POSTER_H}`}
          preserveAspectRatio="xMidYMid slice"
          className={styles.posterSvg}
          aria-label="Static route preview"
        >
          <defs>
            <linearGradient id="relive-bg" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0d1b2a" />
              <stop offset="100%" stopColor="#07111d" />
            </linearGradient>
            <filter id="relive-glow">
              <feGaussianBlur stdDeviation="5" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <rect width={POSTER_W} height={POSTER_H} fill="url(#relive-bg)" />
          {Array.from({ length: 13 }).map((_, i) => (
            <line
              key={`v${i}`}
              x1={(i / 12) * POSTER_W}
              y1={0}
              x2={(i / 12) * POSTER_W}
              y2={POSTER_H}
              stroke="rgba(120,150,190,0.08)"
            />
          ))}
          {Array.from({ length: 9 }).map((_, i) => (
            <line
              key={`h${i}`}
              x1={0}
              y1={(i / 8) * POSTER_H}
              x2={POSTER_W}
              y2={(i / 8) * POSTER_H}
              stroke="rgba(120,150,190,0.08)"
            />
          ))}
          <path
            d={poster.path}
            fill="none"
            stroke="rgba(245,158,11,0.16)"
            strokeWidth={10}
            strokeLinejoin="round"
          />
          <path
            d={poster.path}
            fill="none"
            stroke="#f59e0b"
            strokeWidth={2.2}
            strokeLinejoin="round"
            filter="url(#relive-glow)"
          />
          <circle cx={startX} cy={startY} r={5} fill="#86efac" />
          <circle cx={endX} cy={endY} r={5} fill="#fca5a5" />
          <circle
            cx={poseX}
            cy={poseY}
            r={13}
            fill="none"
            stroke="rgba(245,158,11,0.55)"
            strokeDasharray="3 4"
          />
          <circle
            cx={riderX}
            cy={riderY}
            r={9}
            fill="rgba(245,158,11,0.25)"
          />
          <circle cx={riderX} cy={riderY} r={4.5} fill="#f59e0b" />
          </svg>
          <div className={styles.posterVignette} />
        </div>
      )}

      <div className={styles.mapBadge}>
        {mapReady
          ? `Google 3D${mapBudgetInfo ? ` · ${mapBudgetInfo.used}/${mapBudgetInfo.limit} opens` : ''}`
          : mapError
            ? `3D map unavailable — ${mapError}`
            : '3D map loading…'}
      </div>

      <a
        className={styles.mapAttribution}
        href="https://maps.google.com"
        target="_blank"
        rel="noreferrer"
      >
        Google Maps
      </a>

      <div className={styles.titleCard}>
        {backHref && (
          <Link href={backHref} className={styles.back}>
            ← Activity
          </Link>
        )}
        <div className={styles.eyebrow}>{eyebrow}</div>
        <h1>{ride.name}</h1>
        <div className={styles.meta}>
          {formatDate(ride.date)} · {formatDistance(ride.stats.distanceM)} ·{' '}
          {formatDuration(ride.stats.movingS)}
        </div>
        <div className={styles.weather}>{weatherLine(ride)}</div>
      </div>

      <div className={styles.hint}>
        {mapReady
          ? 'drag to explore · scroll to zoom · right-drag to rotate · 1–6 presets · P play · D data · F follow'
          : 'static route preview · 1–6 presets · P play · D data · F follow'}
      </div>

      <div className={styles.telemetry}>
        <div>
          <span>SPEED</span>
          <b>{(ride.streams.v[index] * 3.6).toFixed(1)} km/h</b>
        </div>
        <div>
          <span>HEART</span>
          <b>{Math.round(ride.streams.hr[index])} bpm</b>
        </div>
        <div>
          <span>GRADE</span>
          <b>
            {ride.streams.grade[index] >= 0 ? '+' : ''}
            {ride.streams.grade[index].toFixed(1)}%
          </b>
        </div>
        <div>
          <span>DIST</span>
          <b>{formatDistance(ride.streams.d[index])}</b>
        </div>
      </div>

      <div className={styles.dock}>
        {dataVisible && (
          <ReliveStory
            ride={ride}
            t={t}
            index={index}
            ghost={ghost}
            ghostIndex={ghostIndex}
            onSeek={(next) => {
              setT(next);
              setPlaying(false);
            }}
          />
        )}
        <div className={styles.presetBar}>
          {ghosts && ghosts.length > 0 && (
            <>
              <span className={styles.ghostLabel} aria-hidden="true">
                Ghost
              </span>
              <span
                className={styles.ghostGroup}
                role="group"
                aria-label="Ghost rider"
              >
                <button
                  type="button"
                  className={`${styles.preset} ${!ghostId ? styles.active : ''}`}
                  aria-pressed={!ghostId}
                  onClick={() => onGhostChange?.(null)}
                >
                  Off
                </button>
                {ghosts.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={`${styles.preset} ${ghostId === option.id ? styles.active : ''}`}
                    aria-pressed={ghostId === option.id}
                    aria-label={
                      option.pb
                        ? `Race the route best, ${option.label}`
                        : `Race ${option.label}`
                    }
                    onClick={() => onGhostChange?.(option.id)}
                    title={option.pb ? 'Fastest ride on this route' : undefined}
                  >
                    {option.pb && <span className={styles.pb}>PB</span>}
                    {option.label}
                  </button>
                ))}
                {ghostLoading && (
                  <span className={styles.ghostNote}>loading…</span>
                )}
              </span>
              <span className={styles.sep} aria-hidden="true" />
            </>
          )}
          {POSES.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`${styles.preset} ${pose === p.id ? styles.active : ''}`}
              aria-pressed={pose === p.id}
              onClick={() => selectPose(p.id)}
            >
              {ride.poseLabels?.[p.id] ?? p.label}
            </button>
          ))}
          <span className={styles.sep} />
          <button
            type="button"
            className={styles.play}
            onClick={() => setPlaying((value) => !value)}
          >
            {playing ? 'Pause' : 'Play'}
          </button>
          <button
            type="button"
            className={`${styles.follow} ${follow ? styles.active : ''}`}
            onClick={() => setFollow((value) => !value)}
            title="Follow the rider"
          >
            Follow
          </button>
          <button
            type="button"
            className={`${styles.data} ${dataVisible ? styles.active : ''}`}
            onClick={() => setDataVisible((value) => !value)}
          >
            Data
          </button>
          <select
            className={styles.speed}
            value={speed}
            onChange={(event) => setSpeed(Number(event.target.value))}
            aria-label="Playback speed"
          >
            <option value={60}>60×</option>
            <option value={120}>120×</option>
            <option value={300}>300×</option>
          </select>
        </div>
        <div className={styles.timeline}>
          <input
            type="range"
            min={t0}
            max={t1}
            step={1}
            value={t}
            onChange={(event) => {
              setT(Number(event.target.value));
              setPlaying(false);
            }}
            aria-label="Ride time"
          />
          <div className={styles.timelineMeta}>
            <span>{formatClock(t)}</span>
            <span>{formatDistance(ride.stats.distanceM)} loop</span>
          </div>
        </div>
      </div>
    </div>
  );
}
