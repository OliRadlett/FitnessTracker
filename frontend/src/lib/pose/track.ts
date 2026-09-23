// Pose-track helpers (§3.18 / F2). Parses the compact JSON persisted by the
// backend (`pose_track.build_track_payload`) and drives the interactive canvas.

export interface TrackFrame {
  t: number | null;
  /** 33 landmarks as [x, y, visibility] in normalised video coords. */
  lm: [number, number, number][] | null;
  /** 33 metric 3D world landmarks as [x, y, z], or null. */
  w: [number, number, number][] | null;
}

export interface TrackRep {
  rep_number?: number;
  start_time?: number | null;
  end_time?: number | null;
  concentric_velocity_ms?: number | null;
}

export interface PoseTrack {
  version: number;
  fps?: number | null;
  exercise?: string | null;
  frames: TrackFrame[];
  reps: TrackRep[];
  bar_path?: Record<string, unknown> | null;
}

// MediaPipe Pose skeleton — the joints that matter for a lifting overlay.
export const POSE_CONNECTIONS: [number, number][] = [
  // torso
  [11, 12],
  [11, 23],
  [12, 24],
  [23, 24],
  // arms
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  // legs
  [23, 25],
  [25, 27],
  [24, 26],
  [26, 28],
  // feet
  [27, 29],
  [29, 31],
  [27, 31],
  [28, 30],
  [30, 32],
  [28, 32],
  // head (approximate neck->nose + ears)
  [11, 0],
  [12, 0],
];

/** Bar-proxy point: shoulder midpoint for squats, wrist midpoint otherwise. */
export function barPoint(
  lm: [number, number, number][],
  exercise?: string | null,
): [number, number] {
  const squat = /squat/i.test(exercise ?? '');
  const [a, b] = squat ? [11, 12] : [15, 16];
  return [(lm[a][0] + lm[b][0]) / 2, (lm[a][1] + lm[b][1]) / 2];
}

export function parsePoseTrack(raw: string): PoseTrack | null {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.frames)) return null;
    return {
      version: parsed.version ?? 1,
      fps: parsed.fps ?? null,
      exercise: parsed.exercise ?? null,
      frames: parsed.frames,
      reps: Array.isArray(parsed.reps) ? parsed.reps : [],
      bar_path: parsed.bar_path ?? null,
    };
  } catch {
    return null;
  }
}

/** Index of the frame whose timestamp is closest to (and not after) `time`. */
export function frameIndexAt(track: PoseTrack, time: number): number {
  const frames = track.frames;
  if (frames.length === 0) return -1;
  // Frames are time-ordered; binary search for the last t <= time.
  let lo = 0;
  let hi = frames.length - 1;
  let best = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const t = frames[mid].t ?? 0;
    if (t <= time) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

export interface Letterbox {
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
}

/** Where a video's content sits inside its element under `object-contain`. */
export function letterbox(
  containerW: number,
  containerH: number,
  videoW: number,
  videoH: number,
): Letterbox {
  if (!videoW || !videoH || !containerW || !containerH) {
    return { offsetX: 0, offsetY: 0, width: containerW, height: containerH };
  }
  const scale = Math.min(containerW / videoW, containerH / videoH);
  const width = videoW * scale;
  const height = videoH * scale;
  return {
    offsetX: (containerW - width) / 2,
    offsetY: (containerH - height) / 2,
    width,
    height,
  };
}
