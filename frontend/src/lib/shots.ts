/**
 * Cinematic shot library for the Relive auto-tour (next-level Phase B).
 *
 * Beats (`lib/beats.ts`) decide *when* something worth watching happens;
 * shots decide *how the camera moves through it*. Each template builds a
 * short scripted `DirectorPath` around the rider's position at a timestamp —
 * the component plays it back exactly like the cinematic intro (sample per
 * frame, hand off to a follow mode at the end). Shots are tour-only: manual
 * camera selection never offers them.
 *
 * Pure — three.js math only, no DOM — unit-tested.
 */

import type { ReplayPoint } from './replay';
import type { BeatKind } from './beats';
import type { DirectorPath, Keyframe } from './director';

export type ShotKind = 'chase-low' | 'track' | 'orbit-punch' | 'drone-pull' | 'rise-reveal';

/** Wide reveal shots that want the full course visible (not the windowed road). */
export function shotWantsOverview(kind: ShotKind): boolean {
  return kind === 'drone-pull' || kind === 'rise-reveal';
}

/** Beat → signature shot. Highlights keep their existing follow-cam treatment. */
export function pickBeatShot(kind: BeatKind): ShotKind {
  if (kind === 'finale') return 'rise-reveal';
  if (kind === 'comeback') return 'track';
  return 'chase-low';
}

export interface ShotOptions {
  /** scripted duration, seconds (per-template default when omitted) */
  durationS?: number;
}

interface Pose {
  pos: [number, number, number];
  /** horizontal heading, unit length (falls back to +X on degenerate windows) */
  dir: [number, number];
}

/** Rider position + horizontal heading at `elapsed` (mirrors the tick's poseAt). */
function poseAtTime(points: ReplayPoint[], elapsed: number): Pose {
  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (points[mid].elapsed <= elapsed) lo = mid;
    else hi = mid - 1;
  }
  const p0 = points[lo];
  const p1 = points[Math.min(points.length - 1, lo + 1)];
  const spanE = p1.elapsed - p0.elapsed || 1;
  const f = p1 === p0 ? 0 : Math.max(0, Math.min(1, (elapsed - p0.elapsed) / spanE));
  const pos: [number, number, number] = [
    p0.x + (p1.x - p0.x) * f,
    p0.y + (p1.y - p0.y) * f,
    p0.z + (p1.z - p0.z) * f,
  ];
  const a = points[Math.max(0, lo - 4)];
  const b = points[Math.min(points.length - 1, lo + 6)];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  const dir: [number, number] = len > 1e-9 ? [dx / len, dy / len] : [1, 0];
  return { pos, dir };
}

const DEFAULT_DURATIONS: Record<ShotKind, number> = {
  'chase-low': 6,
  'track': 7,
  'orbit-punch': 6,
  'drone-pull': 8,
  'rise-reveal': 8,
};

interface ShotFrame {
  /** camera offset: [along-track, lateral, up] in metres, rider-relative */
  off: [number, number, number];
  /** look target: [ahead along-track, lateral, up] in metres, rider-relative */
  look: [number, number, number];
  fov: number;
}

/**
 * Build a scripted shot around the rider at `atElapsed`. Returns an empty
 * path when the ride has no usable geometry — the caller falls back to a
 * follow mode instead of playing nothing.
 */
export function buildShotPath(
  points: ReplayPoint[],
  kind: ShotKind,
  atElapsed: number,
  opts: ShotOptions = {}
): DirectorPath {
  if (points.length < 2) return { keyframes: [], duration: 0 };
  const duration = opts.durationS ?? DEFAULT_DURATIONS[kind];
  if (!(duration > 0)) return { keyframes: [], duration: 0 };
  const { pos: r, dir } = poseAtTime(points, atElapsed);
  const [hx, hy] = dir;
  const left: [number, number] = [-hy, hx];

  // Per-template storyboard: a handful of (offset, look, fov) beats that the
  // sampler interpolates between. All heights ride above the path altitude —
  // the tick's terrain clamp keeps the camera out of hillsides regardless.
  let frames: ShotFrame[];
  switch (kind) {
    case 'chase-low': // ground-hugging chase for attacks/sprints
      frames = [
        { off: [-5.5, 0, 1.8], look: [18, 0, 1.2], fov: 58 },
        { off: [-4.5, 0.8, 1.6], look: [18, 0, 1.2], fov: 55 },
      ];
      break;
    case 'track': // lateral dolly alongside the rider
      frames = [
        { off: [2, 11, 3.2], look: [8, 0, 1.2], fov: 50 },
        { off: [-2, 9, 2.6], look: [6, 0, 1.2], fov: 50 },
      ];
      break;
    case 'orbit-punch': // quick close half-orbit
      frames = [0, 1, 2, 3, 4].map((i) => {
        const a = Math.PI * 0.9 + (i / 4) * Math.PI * 1.0;
        return {
          off: [Math.cos(a) * (13 - i), Math.sin(a) * (13 - i), 6 - i * 0.5] as [number, number, number],
          look: [4, 0, 1.3] as [number, number, number],
          fov: 54 - i,
        };
      });
      break;
    case 'drone-pull': // start tight, pull up and back to reveal the landscape
      frames = [
        { off: [-9, 0, 4], look: [12, 0, 1.5], fov: 55 },
        { off: [-20, -4, 9], look: [12, 0, 1.0], fov: 51 },
        { off: [-30, -6, 15], look: [10, 0, 0.5], fov: 48 },
      ];
      break;
    case 'rise-reveal': // climb out of the bars to reveal what is ahead
      frames = [
        { off: [-7, 0, 2], look: [10, 0, 1.2], fov: 60 },
        { off: [-9, 3, 12], look: [25, 0, 0.5], fov: 52 },
        { off: [-12, 5, 26], look: [40, 0, 0], fov: 46 },
      ];
      break;
  }

  const toWorld = (o: [number, number, number]): [number, number, number] => [
    r[0] + hx * o[0] + left[0] * o[1],
    r[1] + hy * o[0] + left[1] * o[1],
    r[2] + o[2],
  ];
  const keyframes: Keyframe[] = frames.map((f, i) => ({
    time: (i / (frames.length - 1)) * duration,
    position: toWorld(f.off),
    target: toWorld(f.look),
    fov: f.fov,
  }));
  return { keyframes, duration };
}
