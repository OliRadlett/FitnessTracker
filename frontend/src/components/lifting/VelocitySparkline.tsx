'use client';

// Bar-speed sparkline synced to the playhead (§3.18 / F2). Per-frame speed is
// derived from the persisted bar points; the shape (slow sticking point, fast
// lockout) is what matters, so units are relative.

import React, { useEffect, useMemo, useState } from 'react';
import { type PoseTrack, barPoint } from '@/lib/pose/track';

const W = 280;
const H = 36;

export function VelocitySparkline({
  videoRef,
  track,
}: {
  videoRef: React.RefObject<HTMLVideoElement>;
  track: PoseTrack;
}) {
  const [time, setTime] = useState(0);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    let raf = 0;
    const tick = () => {
      setTime(v.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [videoRef]);

  const speeds = useMemo(() => {
    const pts = track.frames.map((f) =>
      f.lm ? barPoint(f.lm, track.exercise) : null,
    );
    const out: number[] = [0];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const ta = track.frames[i - 1]?.t ?? 0;
      const tb = track.frames[i]?.t ?? 0;
      if (!a || !b) {
        out.push(0);
        continue;
      }
      const dt = Math.max((tb ?? 0) - (ta ?? 0), 1e-3);
      out.push(Math.hypot(b[0] - a[0], b[1] - a[1]) / dt);
    }
    return out;
  }, [track]);

  const max = Math.max(...speeds, 1e-6);
  const path = speeds
    .map((s, i) => {
      const x = (i / Math.max(speeds.length - 1, 1)) * W;
      const y = H - (s / max) * (H - 4) - 2;
      return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const end = track.frames.at(-1)?.t ?? 1;
  const frac = end > 0 ? time / end : 0;
  const mx = Math.min(W, Math.max(0, frac * W));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-9" aria-label="Bar speed">
      <path d={path} fill="none" stroke="#38bdf8" strokeWidth="1.5" />
      <line x1={mx} y1={0} x2={mx} y2={H} stroke="#facc15" strokeWidth="1.5" />
    </svg>
  );
}
