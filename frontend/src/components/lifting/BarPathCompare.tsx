'use client';

// Ghost overlay of two lifts' bar paths (F2) — each path is normalised to its
// own range so the *shape* (drift, J-curve) can be compared regardless of
// framing or camera. Reads the persisted pose tracks (T5).

import React, { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { LiftVideo } from '@/lib/api';
import { getVideoStreamUrl, useAuthFetch } from '@/lib/api';
import { type PoseTrack, barPoint, parsePoseTrack } from '@/lib/pose/track';

const COLOR_A = '#22c55e';
const COLOR_B = '#3b82f6';

function useTrack(video: LiftVideo) {
  const { authFetch, token } = useAuthFetch();
  return useQuery({
    queryKey: ['video-track', video.id],
    queryFn: async () => {
      const { url } = await getVideoStreamUrl(authFetch, video.id, 'track');
      const res = await fetch(url);
      return parsePoseTrack(await res.text());
    },
    enabled: !!token && !!video.pose_track_r2_key,
    staleTime: Infinity,
  });
}

function barPoints(track: PoseTrack): [number, number][] {
  const pts: [number, number][] = [];
  for (const f of track.frames) {
    if (f.lm) pts.push(barPoint(f.lm, track.exercise));
  }
  return pts;
}

/** Normalise points to 0..1 over their own bounding box (shape comparison). */
function normalize(pts: [number, number][]): [number, number][] {
  if (pts.length === 0) return [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const sx = maxX - minX || 1;
  const sy = maxY - minY || 1;
  return pts.map(([x, y]) => [(x - minX) / sx, (y - minY) / sy]);
}

function label(v: LiftVideo): string {
  const date = new Date(v.created_at).toLocaleDateString();
  return v.weight_kg ? `${date} · ${v.weight_kg} kg` : date;
}

export function BarPathCompare({
  videoA,
  videoB,
}: {
  videoA: LiftVideo;
  videoB: LiftVideo;
}) {
  const { data: ta } = useTrack(videoA);
  const { data: tb } = useTrack(videoB);
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const pad = 20;
    const draw = (track: PoseTrack | null | undefined, color: string) => {
      if (!track) return;
      const pts = normalize(barPoints(track));
      if (pts.length < 2) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      pts.forEach(([x, y], i) => {
        const px = pad + x * (w - 2 * pad);
        const py = pad + y * (h - 2 * pad);
        if (i) ctx.lineTo(px, py);
        else ctx.moveTo(px, py);
      });
      ctx.stroke();
      const [sx, sy] = pts[0];
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(pad + sx * (w - 2 * pad), pad + sy * (h - 2 * pad), 3.5, 0, Math.PI * 2);
      ctx.fill();
    };
    draw(ta, COLOR_A);
    draw(tb, COLOR_B);
  }, [ta, tb]);

  if (!ta && !tb) return null;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-4 text-[11px] text-muted mb-1">
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-full" style={{ background: COLOR_A }} />
          {label(videoA)}
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-full" style={{ background: COLOR_B }} />
          {label(videoB)}
        </span>
      </div>
      <canvas
        ref={ref}
        className="w-full h-56 bg-surface-light/40 rounded-lg"
        aria-label="Bar path overlay"
      />
      <p className="text-[11px] text-muted mt-1">
        Bar path (each normalised to its own range; start = dot). Close paths mean
        similar technique.
      </p>
    </div>
  );
}
