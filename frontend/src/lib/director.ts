/**
 * Cinematic camera director for the Relive 3D viewer.
 *
 * Generates smooth, broadcast-style camera paths from route geometry so a
 * replay can open with a dramatic flyover, spiral down to the rider, then settle
 * into a chase — instead of a static preset. All math is pure (no three/DOM)
 * and unit-tested; the component layer feeds it a `ReplayBuildResult` and reads
 * back `(position, target, fov)` each frame.
 *
 * Pipeline:
 *   route points -> buildDirectorPath() -> keyframes (pos/target/fov/time)
 *   director.sample(t) -> { pos, target, fov }
 */

import * as THREE from 'three';
import type { ReplayBuildResult } from './replay';

export interface Keyframe {
  time: number; // seconds along the path
  position: [number, number, number];
  target: [number, number, number];
  fov: number; // vertical FOV, degrees
}

export interface DirectorPath {
  keyframes: Keyframe[];
  duration: number;
}

export interface CameraSample {
  position: [number, number, number];
  target: [number, number, number];
  fov: number;
}

const vec = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/**
 * Catmull-Rom spline evaluation at parameter u in [0,1] over the whole keyframe
 * list. Smooth, C1-continuous, passes through every keyframe.
 */
function catmullRom(points: THREE.Vector3[], u: number): THREE.Vector3 {
  if (points.length === 0) return new THREE.Vector3(0, 0, 0);
  if (points.length === 1) return points[0].clone();
  const n = points.length - 1;
  const i = Math.min(n - 1, Math.max(0, Math.floor(u * n)));
  const localT = u * n - i;
  const p0 = points[Math.max(0, i - 1)];
  const p1 = points[i];
  const p2 = points[i + 1];
  const p3 = points[Math.min(n, i + 2)];
  const t2 = localT * localT;
  const t3 = t2 * localT;
  return new THREE.Vector3(
    0.5 * ((2 * p1.x) + (-p0.x + p2.x) * localT + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    0.5 * ((2 * p1.y) + (-p0.y + p2.y) * localT + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
    0.5 * ((2 * p1.z) + (-p0.z + p2.z) * localT + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3)
  );
}

/** smoothstep easing */
function ease(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * Build a cinematic path from a replay:
 *  - Phase 0: high, slow arc that sweeps the whole route from above.
 *  - Phase 1: spiral descend, narrowing FOV, ending just behind the start.
 * The result is a fixed-length path independent of ride duration; the component
 * plays it back at a configurable speed.
 */
export function buildDirectorPath(
  build: ReplayBuildResult,
  opts: { introSeconds?: number; heightM?: number } = {}
): DirectorPath {
  const introSeconds = opts.introSeconds ?? 9;
  const points = build.points;
  if (points.length < 2) {
    return { keyframes: [], duration: 0 };
  }

  // bounding box of the route
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z;
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const cz = (minZ + maxZ) / 2;
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const routeSpan = Math.max(spanX, spanY);
  const height = opts.heightM ?? routeSpan * 0.45;
  const start = points[0];

  // One continuous spiral: start high on one side of the route, sweep around
  // while descending and converging on the start point. No phase break —
  // the radius, height, and target all ease smoothly from "overview" to
  // "behind the rider" over the full duration.
  const keyframes: Keyframe[] = [];
  const kfCount = 30;
  for (let i = 0; i <= kfCount; i++) {
    const u = i / kfCount;
    const e = ease(u); // smoothstep: slow start, cruise middle, gentle landing
    // angle: sweep ~200 degrees around the centroid
    const angle = -Math.PI * 0.6 + e * Math.PI * 1.1;
    // radius: from wide overview to tight behind-start
    const radius = routeSpan * (0.55 * (1 - e) + 0.03);
    // height: from high overview to low behind-start
    const h = height * (1 - e) + routeSpan * 0.025 * e;
    // target: blend from centroid to the route start
    const tgtMix = Math.min(1, e * 1.4); // target arrives sooner than the camera
    const camX = cx + Math.cos(angle) * radius * (1 - e * 0.3) + start.x * e * 0.3;
    const camY = cy + Math.sin(angle) * radius * (1 - e * 0.3) + start.y * e * 0.3;
    const camZ = cz + h;
    const tgtX = cx * (1 - tgtMix) + start.x * tgtMix;
    const tgtY = cy * (1 - tgtMix) + start.y * tgtMix;
    const tgtZ = cz * (1 - tgtMix) + (start.z + 1.5) * tgtMix;
    const fov = 55 - e * 16; // narrow as we descend
    keyframes.push({ time: u * introSeconds, position: [camX, camY, camZ], target: [tgtX, tgtY, tgtZ], fov });
  }

  return { keyframes, duration: introSeconds };
}

/** Hold between orbit reframes (a composed static shot), in ms. */
export const ORBIT_HOLD_MS = 7000;
/** Ease duration of a reframe move, in ms. */
export const ORBIT_MOVE_MS = 2500;
/** Reframe step per move, radians (alternates direction). */
export const ORBIT_REFRAME_RAD = Math.PI / 3;

export interface OrbitShot {
  /** current orbit angle, radians around the rider */
  angle: number;
  /** true = static shot, false = easing toward the next angle */
  holding: boolean;
  /** ms timestamp ending the current hold */
  holdUntil: number;
  /** reframe start angle */
  fromAngle: number;
  /** reframe target angle */
  toAngle: number;
  /** ms timestamp the current reframe began */
  moveStart: number;
  /** alternates each reframe so long-run drift cancels instead of circling */
  dirSign: 1 | -1;
  /** last clock seen — backwards jumps (tab-switch clock skew) are ignored */
  lastSeen: number;
}

/** Start a fresh hold at `angle` (e.g. seeded from the live camera). Pure. */
export function seedOrbitShot(nowMs: number, angle: number): OrbitShot {
  return {
    angle,
    holding: true,
    holdUntil: nowMs + ORBIT_HOLD_MS,
    fromAngle: angle,
    toAngle: angle,
    moveStart: 0,
    dirSign: 1,
    lastSeen: nowMs,
  };
}

/**
 * Advance the orbit director to `nowMs`; returns the camera angle for this
 * frame. Holds the composed shot, then eases to a reframed angle — a virtual
 * drone that reframes instead of spinning forever. Mutates and returns state;
 * call once per frame with a monotonic clock. Pure (no three/DOM).
 */
export function updateOrbitShot(s: OrbitShot, nowMs: number): number {
  // Freeze on backwards clock steps instead of un-easing the shot.
  if (nowMs < s.lastSeen) nowMs = s.lastSeen;
  s.lastSeen = nowMs;
  if (s.holding && nowMs >= s.holdUntil) {
    s.holding = false;
    s.fromAngle = s.angle;
    s.toAngle = s.angle + s.dirSign * ORBIT_REFRAME_RAD;
    s.dirSign = s.dirSign > 0 ? -1 : 1;
    s.moveStart = nowMs;
  }
  if (s.holding) return s.angle;
  const t = Math.max(0, Math.min(1, (nowMs - s.moveStart) / ORBIT_MOVE_MS));
  const k = t * t * (3 - 2 * t); // smoothstep ease, no snap at either end
  s.angle = s.fromAngle + (s.toAngle - s.fromAngle) * k;
  if (t >= 1) {
    s.holding = true;
    s.holdUntil = nowMs + ORBIT_HOLD_MS;
  }
  return s.angle;
}

/** Auto-camera sub-modes (scripted modes excluded — they play, not pick). */
export type AutoCamMode = 'orbit' | 'chase' | 'drone' | 'cockpit' | 'flyby';

/**
 * Full camera-mode selector state: manual auto + scripted cinematic intro +
 * scripted tour shots. `shot` is tour-only (never a toolbar/keyboard choice).
 */
export type ReplayCamMode = 'auto' | AutoCamMode | 'cinematic' | 'shot';

export interface AutoCamContext {
  grade: number;
  speed: number;
  power: number | null;
  ftpWatts?: number | null;
  nearHighlight: boolean;
}

/**
 * Pick the best follow angle from ride context. Pure — the component supplies
 * the context, keeps the hysteresis cooldown, and drives the camera.
 */
export function pickAutoCameraMode(ctx: AutoCamContext): AutoCamMode {
  if (ctx.grade > 4) return 'drone'; // climbing — elevated view shows the effort
  if (ctx.grade < -4) return 'flyby'; // descending — cinematic fly-by
  if (ctx.ftpWatts && ctx.power && ctx.power > ctx.ftpWatts * 1.3) return 'chase'; // sprint — dramatic follow
  if (ctx.speed > 16 && ctx.grade > 1) return 'chase'; // fast flat/rolling — chase
  if (ctx.nearHighlight) return 'drone'; // approaching a feature — frame it
  return 'orbit'; // default cinematic orbit
}

/** Sample a path at time t (clamped, with Catmull-Rom interpolation). */
export function samplePath(path: DirectorPath, t: number): CameraSample {
  if (path.keyframes.length === 0) {
    return { position: [0, 0, 100], target: [0, 0, 0], fov: 55 };
  }
  if (path.keyframes.length === 1) {
    const k = path.keyframes[0];
    return { position: [...k.position], target: [...k.target], fov: k.fov };
  }
  const clamped = Math.max(0, Math.min(path.duration, t));
  const u = path.duration > 0 ? clamped / path.duration : 1;

  const positions = path.keyframes.map((k) => vec(...k.position));
  const targets = path.keyframes.map((k) => vec(...k.target));

  // No easing here: buildDirectorPath already bakes the smoothstep into the
  // keyframe geometry (and FOV), so easing again would double-ease the motion
  // and desync position from FOV.
  const pos = catmullRom(positions, u);
  const tgt = catmullRom(targets, u);

  // linear fov interpolation at parameter u
  const fovIdx = u * (path.keyframes.length - 1);
  const fi = Math.min(path.keyframes.length - 2, Math.floor(fovIdx));
  const ft = fovIdx - fi;
  const fov = path.keyframes[fi].fov + (path.keyframes[fi + 1].fov - path.keyframes[fi].fov) * ft;

  return { position: [pos.x, pos.y, pos.z], target: [tgt.x, tgt.y, tgt.z], fov };
}
