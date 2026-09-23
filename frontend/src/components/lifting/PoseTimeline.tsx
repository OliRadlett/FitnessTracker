'use client';

import React, { useEffect, useState } from 'react';
import type { PoseTrack } from '@/lib/pose/track';

interface PoseTimelineProps {
  videoRef: React.RefObject<HTMLVideoElement>;
  track: PoseTrack;
}

/**
 * Per-rep chapters + a velocity bar per rep (§3.18 / F2), synced to the video
 * playhead. Clicking a bar seeks to that rep; bar height encodes the rep's
 * concentric velocity, so the strip doubles as a velocity graph.
 */
export function PoseTimeline({ videoRef, track }: PoseTimelineProps) {
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

  const reps = track.reps.filter(
    (r) => r.start_time != null && r.end_time != null,
  );
  if (reps.length === 0) return null;

  const maxV = Math.max(
    ...reps.map((r) => r.concentric_velocity_ms ?? 0),
    0.01,
  );
  const active = reps.findIndex(
    (r) => time >= (r.start_time ?? 0) && time <= (r.end_time ?? 0),
  );

  const seek = (t: number | null | undefined) => {
    const v = videoRef.current;
    if (v && t != null) v.currentTime = t;
  };

  // Time of the sticking point (apex of difficulty) within a rep's concentric.
  const stickTime = (r: (typeof reps)[number]): number | null => {
    if (r.start_time == null) return null;
    const dur =
      r.concentric_time ?? (r.end_time ?? r.start_time) - r.start_time;
    if (r.sticking_position_pct == null || !dur) return null;
    return r.start_time + (r.sticking_position_pct / 100) * dur;
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px] text-muted">
        <span>
          {active >= 0
            ? `Rep ${reps[active].rep_number ?? active + 1} / ${reps.length}`
            : `${reps.length} reps`}
        </span>
        <span>
          {active >= 0 && reps[active].concentric_velocity_ms != null
            ? `${reps[active].concentric_velocity_ms!.toFixed(2)} m/s`
            : ''}
        </span>
      </div>
      <div className="flex items-end gap-1 h-8">
        {reps.map((r, i) => {
          const v = r.concentric_velocity_ms ?? 0;
          const heightPct = Math.max(10, (v / maxV) * 100);
          const isActive = i === active;
          return (
            <button
              key={i}
              type="button"
              onClick={() => seek(r.start_time)}
              title={`Rep ${r.rep_number ?? i + 1}: ${v.toFixed(2)} m/s`}
              aria-label={`Rep ${r.rep_number ?? i + 1}, ${v.toFixed(2)} m/s`}
              style={{ height: `${heightPct}%` }}
              className={`flex-1 min-w-[6px] rounded-sm transition-colors ${
                isActive ? 'bg-accent' : 'bg-surface-light hover:bg-accent/40'
              }`}
            />
          );
        })}
      </div>
      {active >= 0 && (
        <div className="flex items-center gap-3 text-[10px] text-muted">
          <span className="uppercase tracking-wide">Key moments</span>
          <button
            type="button"
            onClick={() => seek(reps[active].start_time)}
            className="hover:text-foreground"
          >
            ▶ Start
          </button>
          <button
            type="button"
            onClick={() => seek(stickTime(reps[active]))}
            className="hover:text-foreground"
            title={
              reps[active].sticking_joint_angle != null
                ? `joint ${Math.round(reps[active].sticking_joint_angle!)}°`
                : undefined
            }
          >
            ◆ Apex
            {reps[active].sticking_joint_angle != null
              ? ` ${Math.round(reps[active].sticking_joint_angle!)}°`
              : ''}
          </button>
          <button
            type="button"
            onClick={() => seek(reps[active].end_time)}
            className="hover:text-foreground"
          >
            ■ Stop
          </button>
        </div>
      )}
    </div>
  );
}
