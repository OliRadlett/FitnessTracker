'use client';

import React, { useEffect, useRef } from 'react';
import {
  POSE_CONNECTIONS,
  type PoseTrack,
  barPoint,
  frameIndexAt,
  letterbox,
} from '@/lib/pose/track';

interface PoseCanvasProps {
  videoRef: React.RefObject<HTMLVideoElement>;
  track: PoseTrack;
  showSkeleton?: boolean;
  showBarPath?: boolean;
}

/**
 * Client-rendered skeleton + bar-path overlay, synced to the video playhead
 * via `requestAnimationFrame`. Reads the persisted pose track (T5) so it needs
 * no server-side re-render. Positioned absolutely over the video's container.
 */
export function PoseCanvas({
  videoRef,
  track,
  showSkeleton = true,
  showBarPath = true,
}: PoseCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const draw = () => {
      const parent = canvas.parentElement;
      if (parent) {
        const dpr = window.devicePixelRatio || 1;
        const cw = parent.clientWidth;
        const ch = parent.clientHeight;
        if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
          canvas.width = Math.round(cw * dpr);
          canvas.height = Math.round(ch * dpr);
          canvas.style.width = `${cw}px`;
          canvas.style.height = `${ch}px`;
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, cw, ch);

        const box = letterbox(cw, ch, video.videoWidth, video.videoHeight);
        const toPx = (x: number, y: number): [number, number] => [
          box.offsetX + x * box.width,
          box.offsetY + y * box.height,
        ];

        const idx = frameIndexAt(track, video.currentTime);
        if (idx >= 0) {
          const frame = track.frames[idx];

          if (showBarPath) {
            const from = Math.max(0, idx - Math.round((track.fps ?? 10) * 6));
            ctx.lineWidth = 2;
            ctx.strokeStyle = 'rgba(250, 204, 21, 0.85)';
            ctx.beginPath();
            let started = false;
            for (let i = from; i <= idx; i++) {
              const f = track.frames[i];
              if (!f.lm) continue;
              const [bx, by] = barPoint(f.lm, track.exercise);
              const [px, py] = toPx(bx, by);
              if (!started) {
                ctx.moveTo(px, py);
                started = true;
              } else {
                ctx.lineTo(px, py);
              }
            }
            if (started) ctx.stroke();
            if (frame.lm) {
              const [bx, by] = barPoint(frame.lm, track.exercise);
              const [px, py] = toPx(bx, by);
              ctx.fillStyle = 'rgba(250, 204, 21, 1)';
              ctx.beginPath();
              ctx.arc(px, py, 4, 0, Math.PI * 2);
              ctx.fill();
            }
          }

          if (showSkeleton && frame.lm) {
            const lm = frame.lm;
            ctx.lineWidth = 3;
            ctx.strokeStyle = 'rgba(56, 189, 248, 0.95)';
            for (const [a, b] of POSE_CONNECTIONS) {
              if ((lm[a]?.[2] ?? 0) < 0.3 || (lm[b]?.[2] ?? 0) < 0.3) continue;
              const [ax, ay] = toPx(lm[a][0], lm[a][1]);
              const [bx2, by2] = toPx(lm[b][0], lm[b][1]);
              ctx.beginPath();
              ctx.moveTo(ax, ay);
              ctx.lineTo(bx2, by2);
              ctx.stroke();
            }
            ctx.fillStyle = 'rgba(226, 232, 240, 0.95)';
            for (const p of lm) {
              if ((p[2] ?? 0) < 0.3) continue;
              const [px, py] = toPx(p[0], p[1]);
              ctx.beginPath();
              ctx.arc(px, py, 2.5, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        }
      }
      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [videoRef, track, showSkeleton, showBarPath]);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0"
      aria-hidden="true"
    />
  );
}
