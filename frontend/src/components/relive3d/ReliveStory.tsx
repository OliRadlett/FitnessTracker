'use client';

import { useMemo } from 'react';

import {
  formatClock,
  formatDistance,
  timeAtDistance,
  type Ride,
  type RideHighlight,
} from '@/lib/relive3d/types';
import styles from './ReliveStory.module.css';

const PROFILE_W = 1000;
const PROFILE_H = 150;
const SPARK_W = 1000;
const SPARK_H = 26;

interface Props {
  ride: Ride;
  t: number;
  index: number;
  ghost?: Ride | null;
  ghostIndex?: number;
  onSeek: (t: number) => void;
}

function sparkPath(values: number[]): string {
  if (values.length === 0) return '';
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    min = Math.min(min, v);
    max = Math.max(max, v);
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return '';
  const span = max - min || 1;
  return values
    .map((v, i) => {
      const x = (i / Math.max(1, values.length - 1)) * SPARK_W;
      const y = SPARK_H - ((v - min) / span) * (SPARK_H - 4) - 2;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

function chapterTarget(ride: Ride, h: RideHighlight): number {
  if (h.startD != null) return h.startD;
  if (h.idx != null) return ride.streams.d[h.idx] ?? 0;
  return 0;
}

function Chapter({
  label,
  onClick,
  tone,
}: {
  label: string;
  onClick: () => void;
  tone: 'climb' | 'descent' | 'fastest' | 'high';
}) {
  return (
    <button
      type="button"
      className={`${styles.chapter} ${styles[tone]}`}
      onClick={onClick}
      title={label}
    >
      {label}
    </button>
  );
}

export function ReliveStory({
  ride,
  t,
  index,
  ghost,
  ghostIndex,
  onSeek,
}: Props) {
  const n = ride.streams.t.length;
  const maxD = ride.streams.d[n - 1] || 1;
  const altMin = Math.min(...ride.streams.alt);
  const altMax = Math.max(...ride.streams.alt);
  const altSpan = altMax - altMin || 1;

  const x = (d: number) => (d / maxD) * PROFILE_W;
  const y = (alt: number) =>
    PROFILE_H - ((alt - altMin) / altSpan) * (PROFILE_H - 8) - 4;

  const profile = useMemo(() => {
    const points = ride.streams.d.map((d, i) => ({
      x: x(d),
      y: y(ride.streams.alt[i]),
    }));
    const line = points
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
      .join(' ');
    const area = `M0,${PROFILE_H} ${line.replace(/^M/, 'L')} L${PROFILE_W},${PROFILE_H} Z`;
    return { line, area };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ride, maxD, altMin, altSpan]);

  const hrPath = useMemo(() => sparkPath(ride.streams.hr), [ride]);
  const speedPath = useMemo(() => sparkPath(ride.streams.v), [ride]);
  const gradePath = useMemo(() => sparkPath(ride.streams.grade), [ride]);

  const playhead = (ride.streams.d[index] / maxD) * 100;
  const hr = Math.round(ride.streams.hr[index] ?? 0);
  const speed = (ride.streams.v[index] ?? 0) * 3.6;
  const grade = ride.streams.grade[index] ?? 0;
  const alt = ride.streams.alt[index] ?? 0;
  const ghostD =
    ghost && ghostIndex != null && ghostIndex >= 0
      ? ghost.streams.d[ghostIndex]
      : null;
  const delta = ghostD != null ? ride.streams.d[index] - ghostD : null;

  const seekFromEvent = (clientX: number, rect: DOMRect) => {
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    onSeek(timeAtDistance(ride, frac * maxD));
  };

  return (
    <section className={styles.panel} aria-label="Ride story">
      <div className={styles.head}>
        <div className={styles.chapters}>
          <Chapter
            label={`Climb ${(ride.highlights.climb.gradePct ?? 0).toFixed(1)}%`}
            tone="climb"
            onClick={() =>
              onSeek(timeAtDistance(ride, chapterTarget(ride, ride.highlights.climb)))
            }
          />
          <Chapter
            label={`Descent ${Math.abs(ride.highlights.descent.gradePct ?? 0).toFixed(1)}%`}
            tone="descent"
            onClick={() =>
              onSeek(
                timeAtDistance(ride, chapterTarget(ride, ride.highlights.descent)),
              )
            }
          />
          <Chapter
            label={`Fastest km ${(ride.highlights.fastestKm.speedKmh ?? 0).toFixed(1)} km/h`}
            tone="fastest"
            onClick={() =>
              onSeek(
                timeAtDistance(ride, chapterTarget(ride, ride.highlights.fastestKm)),
              )
            }
          />
          <Chapter
            label={`High point ${(ride.highlights.highest.altM ?? 0).toFixed(0)} m`}
            tone="high"
            onClick={() =>
              onSeek(
                timeAtDistance(ride, chapterTarget(ride, ride.highlights.highest)),
              )
            }
          />
        </div>
        <div className={styles.readout}>
          {Math.round(alt)} m · {hr} bpm · {speed.toFixed(1)} km/h ·{' '}
          {grade >= 0 ? '+' : ''}
          {grade.toFixed(1)}%
        </div>
      </div>

      <div
        className={styles.track}
        onPointerDown={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          event.currentTarget.setPointerCapture(event.pointerId);
          seekFromEvent(event.clientX, rect);
        }}
        onPointerMove={(event) => {
          if (event.buttons !== 1) return;
          const rect = event.currentTarget.getBoundingClientRect();
          seekFromEvent(event.clientX, rect);
        }}
      >
        <svg
          className={styles.profile}
          viewBox={`0 0 ${PROFILE_W} ${PROFILE_H}`}
          preserveAspectRatio="none"
          aria-label="Elevation profile"
        >
          <path className={styles.profileArea} d={profile.area} />
          <path className={styles.profileLine} d={profile.line} />
        </svg>

        <div className={styles.sparklines}>
          <div className={styles.spark}>
            <span className={styles.sparkLabel}>HR</span>
            <svg viewBox={`0 0 ${SPARK_W} ${SPARK_H}`} preserveAspectRatio="none">
              <path className={styles.sparkHr} d={hrPath} />
            </svg>
          </div>
          <div className={styles.spark}>
            <span className={styles.sparkLabel}>SPEED</span>
            <svg viewBox={`0 0 ${SPARK_W} ${SPARK_H}`} preserveAspectRatio="none">
              <path className={styles.sparkSpeed} d={speedPath} />
            </svg>
          </div>
          <div className={styles.spark}>
            <span className={styles.sparkLabel}>GRADE</span>
            <svg viewBox={`0 0 ${SPARK_W} ${SPARK_H}`} preserveAspectRatio="none">
              <path className={styles.sparkGrade} d={gradePath} />
            </svg>
          </div>
        </div>

        <div className={styles.playhead} style={{ left: `${playhead}%` }} />
      </div>

      <div className={styles.footer}>
        <span>{formatClock(t)}</span>
        <span>
          {delta != null
            ? `Ghost ${delta >= 0 ? '+' : ''}${delta.toFixed(0)} m`
            : `${formatDistance(ride.stats.distanceM)} loop`}
        </span>
      </div>
    </section>
  );
}
