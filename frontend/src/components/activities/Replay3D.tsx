'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import type { ReplayBuildResult, ReplayColorMode, ReplayPoint } from '@/lib/replay';
import { TOUR_PRESETS, powerZoneBounds, replayMetricColor, replayMetricScale, replayMetricValue, timeFmt, tourRate } from '@/lib/replay';
import { decodePolyline } from '@/lib/polyline';
import { DESCENT_COLOR, GRADE_RAMP, slopeColor } from '@/lib/route3d';
import { createBikeRig, leanFromCurvature, type BikeRig } from '@/lib/bike';
import { buildRoadRibbon } from '@/lib/road';
import { detectHighlights, highlightAt } from '@/lib/highlights';
import { daylightPhase, solarPosition, sunDirection } from '@/lib/sun';

/** flat RGB array for a LineGeometry under a colour mode (grade uses the diverging ramp) */
function replayPathColorArray(points: ReplayPoint[], mode: ReplayColorMode): number[] {
  const arr = new Array<number>(points.length * 3);
  if (mode === 'grade') {
    points.forEach((p, i) => {
      const [r, g, b] = slopeColor(p.grade ?? 0);
      arr[i * 3] = r;
      arr[i * 3 + 1] = g;
      arr[i * 3 + 2] = b;
    });
  } else {
    const max = replayMetricScale(points, mode);
    points.forEach((p, i) => {
      const [r, g, b] = replayMetricColor(replayMetricValue(p, mode), max);
      arr[i * 3] = r;
      arr[i * 3 + 1] = g;
      arr[i * 3 + 2] = b;
    });
  }
  return arr;
}

/** Coggan zone tints (Z1→Z7) for the power-row background */
const ZONE_COLORS = ['#64748b', '#3b82f6', '#22c55e', '#eab308', '#f97316', '#ef4444', '#a855f7'];

const INTENSITY_GRADIENT = 'linear-gradient(to right, #3b82f6, #ef4444)';
const GRADE_GRADIENT = `linear-gradient(to right, ${DESCENT_COLOR}, ${GRADE_RAMP.map(([, hex]) => hex).join(', ')})`;

function nearestIndex(points: ReplayPoint[], elapsed: number): number {
  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (points[mid].elapsed <= elapsed) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** asphalt ribbon texture: dark surface, dashed centre line, faint edge lines */
function createRoadTexture(): THREE.Texture {
  const s = 128;
  const canvas = document.createElement('canvas');
  canvas.width = s;
  canvas.height = s;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    // mid-grey asphalt so the effort tint reads through the texture
    ctx.fillStyle = '#4a5461';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 500; i++) {
      ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.05})`;
      ctx.fillRect(Math.random() * s, Math.random() * s, 1, 1);
    }
    ctx.strokeStyle = 'rgba(240,244,250,0.9)';
    ctx.lineWidth = 4;
    ctx.setLineDash([18, 18]);
    ctx.beginPath();
    ctx.moveTo(s / 2, 0);
    ctx.lineTo(s / 2, s);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(226,232,240,0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(4, 0);
    ctx.lineTo(4, s);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(s - 4, 0);
    ctx.lineTo(s - 4, s);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** vertical-gradient sky dome that always surrounds the camera (styled dark) */
function createSkyDome(radius: number, top: THREE.Color, bottom: THREE.Color): THREE.Mesh {
  const canvas = document.createElement('canvas');
  canvas.width = 2;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const grad = ctx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, `#${top.getHexString()}`);
    grad.addColorStop(0.55, `#${bottom.getHexString()}`);
    grad.addColorStop(1, '#060a14');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 2, 256);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const geo = new THREE.SphereGeometry(radius, 32, 16);
  const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = -1;
  return mesh;
}

/** Signed lean (radians) from the corner curvature around point `i`. */
function leanAt(points: ReplayPoint[], i: number): number {
  const a = points[Math.max(0, i - 3)];
  const mid = points[i];
  const b = points[Math.min(points.length - 1, i + 3)];
  const h1 = Math.atan2(mid.y - a.y, mid.x - a.x);
  const h2 = Math.atan2(b.y - mid.y, b.x - mid.x);
  let d = h2 - h1;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  const dt = Math.max(0.5, b.elapsed - a.elapsed);
  return leanFromCurvature(mid.speed, d / dt);
}

interface StripRow {
  key: 'hr' | 'power' | 'speed' | 'cadence' | 'altitude';
  label: string;
  color: string;
  unit: string;
}

/** Lean SVG strip: metric traces with a playhead (no Recharts, stays lean). */
export function TelemetryStrip({
  points,
  playhead,
  elevationBase,
  ftpWatts,
}: {
  points: ReplayPoint[];
  playhead: number;
  /** converts exaggerated z back to metres for the altitude row */
  elevationBase?: { altMin: number; zScale: number } | null;
  /** shades Coggan zone bands behind the power row when provided */
  ftpWatts?: number | null;
}) {
  const [expanded, setExpanded] = useState(false);

  const series = useMemo(() => {
    const kmh = points.map((p) => p.speed * 3.6);
    const alt = points.map((p) =>
      elevationBase && elevationBase.zScale
        ? elevationBase.altMin + p.z / elevationBase.zScale
        : null
    );
    const has = (vs: (number | null)[]) => vs.some((v) => v != null && Number.isFinite(v));
    const all: { row: StripRow; values: (number | null)[]; autoMin: boolean }[] = [
      { row: { key: 'hr', label: 'HR', color: '#f59e0b', unit: 'bpm' }, values: points.map((p) => p.hr), autoMin: false },
      { row: { key: 'power', label: 'Power', color: '#3b82f6', unit: 'W' }, values: points.map((p) => p.power), autoMin: false },
      { row: { key: 'speed', label: 'Speed', color: '#38bdf8', unit: 'km/h' }, values: kmh, autoMin: false },
      { row: { key: 'cadence', label: 'Cad', color: '#a78bfa', unit: 'rpm' }, values: points.map((p) => p.cadence), autoMin: false },
      // Flat z (no altitude stream) carries no information — hide the row.
      ...(points.some((p) => p.z !== 0)
        ? [{ row: { key: 'altitude', label: 'Alt', color: '#34d399', unit: 'm' } as StripRow, values: alt, autoMin: true }]
        : []),
    ];
    return all.filter((s) => has(s.values));
  }, [points, elevationBase]);

  const visible = expanded ? series : series.slice(0, 2);

  const ROW_H = 34;
  const W = 200;
  const H = Math.max(1, visible.length) * ROW_H;
  const n = Math.max(2, points.length);

  const trace = (values: (number | null)[], min: number, max: number, rowTop: number, rowBot: number): string => {
    let d = '';
    values.forEach((v, i) => {
      if (v == null || !Number.isFinite(v)) return;
      const x = (i / (n - 1)) * W;
      const y = max > min ? rowBot - ((v - min) / (max - min)) * (rowBot - rowTop) : rowBot;
      d += `${d ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return d;
  };

  const at = useMemo(() => {
    if (!points.length) return null;
    return points[Math.max(0, Math.min(points.length - 1, nearestIndex(points, playhead)))];
  }, [points, playhead]);

  const valueFor = (key: StripRow['key']): string | null => {
    if (!at) return null;
    switch (key) {
      case 'hr':
        return at.hr != null ? `${Math.round(at.hr)}` : null;
      case 'power':
        return at.power != null ? `${Math.round(at.power)}` : null;
      case 'speed':
        return `${(at.speed * 3.6).toFixed(1)}`;
      case 'cadence':
        return at.cadence != null ? `${Math.round(at.cadence)}` : null;
      case 'altitude': {
        if (!elevationBase?.zScale) return null;
        return `${Math.round(elevationBase.altMin + at.z / elevationBase.zScale)}`;
      }
    }
  };

  const playheadX =
    (Math.max(0, Math.min(playhead, points.at(-1)?.elapsed ?? 0)) /
      Math.max(1, points.at(-1)?.elapsed ?? 0)) *
    W;

  return (
    <div className="w-full overflow-hidden rounded border border-surface-light bg-surface/40">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{ height: H }}
        className="block w-full"
        aria-hidden
      >
        {visible.map(({ row, values, autoMin }, r) => {
          const nums = values.filter((v): v is number => v != null && Number.isFinite(v));
          const min = autoMin && nums.length ? Math.min(...nums) : 0;
          const max = nums.length ? Math.max(...nums) : 1;
          const top = r * ROW_H + 4;
          const bot = (r + 1) * ROW_H - 6;
          const scaleMax = Math.max(min + 1e-9, max);
          const yOf = (v: number) =>
            bot - ((Math.max(min, Math.min(scaleMax, v)) - min) / (scaleMax - min)) * (bot - top);
          const showZones = row.key === 'power' && ftpWatts != null && ftpWatts > 0;
          const bounds = showZones ? powerZoneBounds(ftpWatts) : [];
          return (
            <g key={row.key}>
              {r > 0 && (
                <line x1={0} y1={r * ROW_H} x2={W} y2={r * ROW_H} stroke="rgba(148,163,184,0.15)" strokeWidth={0.4} />
              )}
              {showZones &&
                bounds.map((bHi, zi) => {
                  const bLo = zi === 0 ? 0 : bounds[zi - 1];
                  const yHi = yOf(Math.min(bHi, scaleMax));
                  const yLo = yOf(bLo);
                  if (yLo - yHi <= 0.2) return null;
                  return (
                    <rect
                      key={zi}
                      x={0}
                      y={yHi}
                      width={W}
                      height={yLo - yHi}
                      fill={ZONE_COLORS[zi]}
                      opacity={0.13}
                    />
                  );
                })}
              <path d={trace(values, min, Math.max(min + 1e-9, max), top, bot)} fill="none" stroke={row.color} strokeWidth={0.8} strokeLinejoin="round" />
            </g>
          );
        })}
        {playhead > 0 && (
          <line x1={playheadX} y1={0} x2={playheadX} y2={H} stroke="rgba(255,255,255,0.8)" strokeWidth={0.6} />
        )}
      </svg>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2 py-1">
        {visible.map(({ row }) => {
          const v = valueFor(row.key);
          return (
            <span key={row.key} className="text-[10px] uppercase tracking-wide text-muted">
              <span style={{ color: row.color }}>{row.label}</span>
              {v != null && <span className="ml-1 font-mono normal-case text-foreground">{v} {row.unit}</span>}
            </span>
          );
        })}
        {visible.some(({ row }) => row.key === 'power') && ftpWatts != null && ftpWatts > 0 && (
          <span className="text-[10px] uppercase tracking-wide text-muted">
            Zones @ {Math.round(ftpWatts)}W
          </span>
        )}
        {series.length > 2 && (
          <button
            onClick={() => setExpanded((e) => !e)}
            aria-expanded={expanded}
            className="ml-auto min-h-[44px] px-2 text-[10px] uppercase tracking-wide text-muted transition-colors hover:text-foreground"
          >
            {expanded ? 'Less' : `+${series.length - 2} more`}
          </button>
        )}
      </div>
    </div>
  );
}

/** Linked-playback clock owned by a parent (side-by-side compare, Phase E).
 *  `t` is absolute master seconds; each ride renders min(t, ownTotal) so rides
 *  start together in real time and shorter ones finish first. */
export interface ReplayLink {
  t: number;
  span: number;
  onScrub: (t: number) => void;
  onToggle: () => void;
  onRate: (rate: number) => void;
  rate: number;
  playing: boolean;
}

/** 3D ride replay — animated rider marker along the recording path (§3.16).
 *  Camera modes: free-orbit (default), chase, and cockpit follow cams.
 *  Terrain bed is opt-in (button) so the activities page stays light. */
export function Replay3D({
  name,
  build,
  polyline,
  onElapsed,
  link,
  ftpWatts,
  canvasHeightClass = 'h-[300px]',
  theater = false,
  lite,
  startDate = null,
}: {
  name: string;
  build: ReplayBuildResult;
  /** encoded polyline — required only for the opt-in terrain bed */
  polyline?: string;
  /** 10 fps playhead callback for syncing sibling views (Phase D: readout; Phase E: full link) */
  onElapsed?: (seconds: number) => void;
  /** linked clock for side-by-side compare — transport delegates to the parent */
  link?: ReplayLink | null;
  /** rider FTP for Coggan zone bands behind the power row */
  ftpWatts?: number | null;
  /** Tailwind height class for the canvas container (Theater passes a taller one) */
  canvasHeightClass?: string;
  /** full-screen Theater host — trim the in-card chrome */
  theater?: boolean;
  /** force Lite mode (no MSAA, pixel ratio 1); auto-on for small screens */
  lite?: boolean;
  /** ride start time (ISO) — lights the scene for the actual time of day */
  startDate?: string | null;
}) {
  const points = build.points;
  const totalTime = build.totalTime;

  // Lite mode: auto-on for small screens (no MSAA, pixel ratio 1) unless forced.
  const liteMode = lite ?? (typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches);

  // Auto-tour highlights (Phase 4) — computed once per path.
  const highlights = useMemo(() => detectHighlights(points), [points]);

  const mountRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(() => tourRate(totalTime, 60));
  const [displayElapsed, setDisplayElapsed] = useState(0);
  const [camMode, setCamMode] = useState<'orbit' | 'chase' | 'drone' | 'cockpit'>('chase');
  const [colorBy, setColorBy] = useState<ReplayColorMode>('speed');
  const [terrainState, setTerrainState] = useState<'off' | 'loading' | 'on' | 'failed'>('off');
  const [tour, setTour] = useState(false);

  const sceneRef = useRef<{
    renderer: THREE.WebGLRenderer;
    controls: OrbitControls;
    camera: THREE.PerspectiveCamera;
    scene: THREE.Scene;
    grid: THREE.GridHelper;
    rider: THREE.Object3D;
    bike: BikeRig | null;
    trail: Line2;
    pathGeo: LineGeometry | null;
    roadGeo: THREE.BufferGeometry | null;
    home: { pos: THREE.Vector3; target: THREE.Vector3 } | null;
    terrain: THREE.Mesh | null;
  } | null>(null);

  // Playback clock lives in refs so the rAF loop reads the freshest values
  // without a React render per frame.
  const playingRef = useRef(false);
  const rateRef = useRef(rate);
  const elapsedRef = useRef(0);
  const camModeRef = useRef(camMode);
  const colorByRef = useRef<ReplayColorMode>(colorBy);
  const onElapsedRef = useRef(onElapsed);
  const linkRef = useRef(link);
  const followPosRef = useRef<THREE.Vector3 | null>(null);

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);
  useEffect(() => {
    rateRef.current = rate;
  }, [rate]);
  // Tour default follows the ride length (not a stale fixed 4×).
  useEffect(() => {
    setRate(tourRate(totalTime, 60));
  }, [totalTime]);

  // Whole-ride presets for this ride's length, deduped for short rides.
  const tourOptions = useMemo(() => {
    const seen = new Set<number>();
    const opts: { label: string; rate: number; secs: number }[] = [];
    for (const p of TOUR_PRESETS) {
      const r = tourRate(totalTime, p.secs);
      if (seen.has(r)) continue;
      seen.add(r);
      opts.push({ label: p.label, rate: r, secs: p.secs });
    }
    return opts;
  }, [totalTime]);
  useEffect(() => {
    colorByRef.current = colorBy;
  }, [colorBy]);
  useEffect(() => {
    onElapsedRef.current = onElapsed;
  }, [onElapsed]);
  useEffect(() => {
    linkRef.current = link ?? null;
  }, [link]);
  useEffect(() => {
    camModeRef.current = camMode;
    // Re-seed follow smoothing from wherever the orbit camera is now.
    followPosRef.current = null;
  }, [camMode]);

  // Build the three.js scene once for this ride.
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || points.length < 2) {
      setFailed(true);
      return;
    }

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: !liteMode, alpha: true, preserveDrawingBuffer: true });
      if (!renderer.getContext()) throw new Error('no-webgl');
    } catch {
      setFailed(true);
      return;
    }
    renderer.setPixelRatio(liteMode ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;

    const scene = new THREE.Scene();
    // Styled world lit for the ride's actual time of day (golden hour / night).
    const sunDate = startDate ? new Date(startDate) : null;
    const sun = sunDate && !Number.isNaN(sunDate.valueOf()) ? solarPosition(sunDate, build.lat0, build.lng0) : null;
    const phase = sun ? daylightPhase(sun.elevationDeg) : 'day';
    const PALETTE = {
      day: { top: '#0a1428', horizon: '#1b2b46', fog: '#101a2e', light: 0xfff2df, li: 1.4, hi: 0.9 },
      golden: { top: '#12233f', horizon: '#c9762e', fog: '#2a2430', light: 0xffb066, li: 1.6, hi: 0.7 },
      night: { top: '#04060d', horizon: '#0a1322', fog: '#070b14', light: 0x8fb0ff, li: 0.5, hi: 0.4 },
    }[phase];
    const SKY_TOP = new THREE.Color(PALETTE.top);
    const SKY_HORIZON = new THREE.Color(PALETTE.horizon);
    const FOG_COLOR = new THREE.Color(PALETTE.fog);
    scene.add(new THREE.HemisphereLight(SKY_HORIZON.getHex(), 0x0a0f1a, PALETTE.hi));
    const dirLight = new THREE.DirectionalLight(PALETTE.light, PALETTE.li);
    const grid = new THREE.GridHelper(2, 24, 0x334155, 0x1e293b);
    scene.add(grid);

    const minX = Math.min(...points.map((p) => p.x));
    const maxX = Math.max(...points.map((p) => p.x));
    const minY = Math.min(...points.map((p) => p.y));
    const maxY = Math.max(...points.map((p) => p.y));
    const minZ = Math.min(...points.map((p) => p.z));
    const maxZ = Math.max(...points.map((p) => p.z));
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const size = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 100);

    // Gradient sky dome (follows the camera) + distance fog tuned to the ride.
    const sky = createSkyDome(size * 4, SKY_TOP, SKY_HORIZON);
    scene.add(sky);
    scene.fog = new THREE.Fog(FOG_COLOR.getHex(), size * 0.4, size * 3.2);

    const camera = new THREE.PerspectiveCamera(
      55,
      mount.clientWidth / mount.clientHeight,
      0.1,
      size * 10
    );

    // Ground grid, scaled to the ride: GridHelper lives in XZ, so rotate it
    // flat into the path frame (XY) and slide it under the lowest point.
    grid.rotation.x = Math.PI / 2;
    grid.scale.setScalar(size / 2);
    grid.position.set(cx, cy, Math.max(minZ - size * 0.05, 0));
    const sd = sun ? sunDirection(sun) : [0.5, -0.5, 0.8];
    dirLight.position.set(cx + sd[0] * size, cy + sd[1] * size, minZ + Math.max(0.2, sd[2]) * size);
    scene.add(dirLight);

    // Aerial 3/4 default view — flat courses read as a course, not an edge.
    const baseZ = Math.max(minZ - size * 0.05, 0);
    camera.position.set(cx + size * 0.45, cy - size * 0.85, baseZ + size * 1.6);
    camera.lookAt(cx, cy, minZ + (maxZ - minZ) * 0.5);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.target.set(cx, cy, minZ + (maxZ - minZ) * 0.5);
    // Keep zoom inside the scene: close enough for detail, never lost in the void.
    controls.minDistance = 3;
    controls.maxDistance = size * 6;
    controls.rotateSpeed = 0.55;
    // Zoom toward the pointer so exploring a long route doesn't lose it.
    controls.zoomToCursor = true;

    // Home pose for the Reset-view button.
    const homePos = camera.position.clone();
    const homeTarget = controls.target.clone();

    // Double-click (or double-tap) focuses the orbit pivot on the route.
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const onDblClick = (e: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(scene.children, true);
      const hit = hits.find((h) => !(h.object instanceof THREE.Sprite));
      if (hit) {
        controls.target.copy(hit.point);
        controls.update();
      }
    };
    renderer.domElement.addEventListener('dblclick', onDblClick);

    // ── Path line (Line2: constant pixel width, vertex-coloured) ──────────
    const pathPositions: number[] = [];
    points.forEach((p) => {
      pathPositions.push(p.x, p.y, p.z);
    });
    const setLineResolution = (m: LineMaterial) => m.resolution.set(mount.clientWidth, mount.clientHeight);
    const pathGeo = new LineGeometry();
    pathGeo.setPositions(pathPositions);
    pathGeo.setColors(replayPathColorArray(points, colorByRef.current));
    const pathMat = new LineMaterial({ linewidth: 3, vertexColors: true, transparent: true, opacity: 0.9 });
    setLineResolution(pathMat);
    const pathLine = new Line2(pathGeo, pathMat);
    scene.add(pathLine);

    // ── Ridden trail: wider translucent halo, grown via instanceCount ──────
    const trailGeo = new LineGeometry();
    trailGeo.setPositions(pathPositions);
    trailGeo.setColors(new Array<number>(points.length * 3).fill(0.13));
    trailGeo.instanceCount = 0;
    const trailMat = new LineMaterial({ linewidth: 6, color: 0x22d3ee, transparent: true, opacity: 0.3 });
    setLineResolution(trailMat);
    const trail = new Line2(trailGeo, trailMat);
    scene.add(trail);

    // ── Road ribbon: asphalt under the bike, tinted by the effort metric ──
    const roadData = buildRoadRibbon(points, {
      width: 6,
      zOffset: -0.01,
      colors: replayPathColorArray(points, colorByRef.current),
    });
    let roadGeo: THREE.BufferGeometry | null = null;
    let roadMat: THREE.MeshBasicMaterial | null = null;
    let roadTex: THREE.Texture | null = null;
    if (roadData) {
      roadGeo = new THREE.BufferGeometry();
      roadGeo.setAttribute('position', new THREE.BufferAttribute(roadData.positions, 3));
      roadGeo.setAttribute('uv', new THREE.BufferAttribute(roadData.uvs, 2));
      roadGeo.setIndex(new THREE.BufferAttribute(roadData.indices, 1));
      if (roadData.colors) roadGeo.setAttribute('color', new THREE.BufferAttribute(roadData.colors, 3));
      roadTex = createRoadTexture();
      roadMat = new THREE.MeshBasicMaterial({ map: roadTex, vertexColors: !!roadData.colors, side: THREE.DoubleSide });
      scene.add(new THREE.Mesh(roadGeo, roadMat));
    }

    // ── Bike rig: real-scale model, oriented + leaning (Phase 0) ──────────
    const rider = new THREE.Group();
    scene.add(rider);
    const riderDir = new THREE.Vector3(1, 0, 0);
    const UP_Y = new THREE.Vector3(0, 1, 0);
    const UP_Z = new THREE.Vector3(0, 0, 1);
    let bikeRig: BikeRig | null = null;
    let bikeCancelled = false;
    createBikeRig()
      .then((rig) => {
        if (bikeCancelled) {
          rig.dispose();
          return;
        }
        rider.add(rig.object);
        bikeRig = rig;
        if (sceneRef.current) sceneRef.current.bike = rig;
      })
      .catch(() => {
        /* model failed to load — the path line still tells the story */
      });

    // ── Km markers: dot + distance label at regular intervals ──────────────
    // Out-and-back courses revisit the same ground — skip markers that land
    // on top of an earlier one and stagger label heights so pairs separate.
    const markerGroup = new THREE.Group();
    scene.add(markerGroup);
    const markerDisposables: { dispose: () => void }[] = [];
    {
      const totalKm = build.totalDistance / 1000;
      const intervalKm = totalKm > 150 ? 25 : totalKm > 60 ? 10 : 5;
      const dotGeo = new THREE.SphereGeometry(Math.max(size * 0.004, 1.5), 10, 10);
      const dotMat = new THREE.MeshBasicMaterial({ color: 0x94a3b8 });
      markerDisposables.push(dotGeo, dotMat);
      const placed: THREE.Vector3[] = [];
      let stagger = 0;
      for (let k = intervalKm; k < totalKm; k += intervalKm) {
        const target = k * 1000;
        const idx = points.findIndex((pt) => pt.distance >= target);
        if (idx < 0) continue;
        const mp = points[idx];
        const pos = new THREE.Vector3(mp.x, mp.y, mp.z);
        if (placed.some((q) => q.distanceTo(pos) < size * 0.015)) continue;
        placed.push(pos);
        const dot = new THREE.Mesh(dotGeo, dotMat);
        dot.position.copy(pos);
        markerGroup.add(dot);
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.font = 'bold 30px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = 'rgba(15,23,42,0.7)';
          const label = `${k} km`;
          const w = Math.min(248, ctx.measureText(label).width + 30);
          const x0 = (256 - w) / 2;
          if (typeof ctx.roundRect === 'function') {
            ctx.beginPath();
            ctx.roundRect(x0, 8, w, 48, 10);
            ctx.fill();
          } else {
            ctx.fillRect(x0, 8, w, 48);
          }
          ctx.fillStyle = '#e2e8f0';
          ctx.fillText(label, 128, 33);
        }
        const tex = new THREE.CanvasTexture(canvas);
        const spriteMat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
        const sprite = new THREE.Sprite(spriteMat);
        sprite.scale.set(size * 0.055, size * 0.014, 1);
        stagger = stagger === 0 ? 1 : 0;
        sprite.position.set(pos.x, pos.y, pos.z + size * (0.025 + stagger * 0.025));
        markerGroup.add(sprite);
        markerDisposables.push(tex, spriteMat);
      }
    }

    mount.appendChild(renderer.domElement);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    // Let vertical page scrolls pass through on touch (OrbitControls sets
    // touch-action:none); horizontal drags still orbit, pinch still zooms.
    renderer.domElement.style.touchAction = 'pan-y';

    let raf = 0;
    let last = performance.now();
    let prevElapsed = 0;
    const tmpDir = new THREE.Vector3();
    const tmpDesired = new THREE.Vector3();
    const tmpLook = new THREE.Vector3();
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const L = linkRef.current;
      if (L) {
        // Linked clock: the parent owns time; shorter rides freeze at their end.
        elapsedRef.current = Math.max(0, Math.min(L.t, totalTime));
      } else if (playingRef.current) {
        elapsedRef.current += dt * rateRef.current;
        if (elapsedRef.current >= totalTime) {
          elapsedRef.current = totalTime;
          playingRef.current = false;
          setPlaying(false);
        }
      }
      const t = elapsedRef.current;
      const rideDelta = Math.max(0, Math.min(0.25, t - prevElapsed));
      prevElapsed = t;
      const i = nearestIndex(points, t);
      const p0 = points[i];
      const p1 = points[Math.min(points.length - 1, i + 1)];
      // Interpolate the bike between samples so motion is smooth at any
      // decimation (points are distance-stepped, not time-stepped).
      const spanE = p1.elapsed - p0.elapsed || 1;
      const f = p1 === p0 ? 0 : Math.max(0, Math.min(1, (t - p0.elapsed) / spanE));
      rider.position.set(
        p0.x + (p1.x - p0.x) * f,
        p0.y + (p1.y - p0.y) * f,
        p0.z + (p1.z - p0.z) * f
      );
      // Forward from a look-ahead window (smooth, stable at standstill).
      const a = points[Math.max(0, i - 4)];
      const b = points[Math.min(points.length - 1, i + 6)];
      tmpDir.set(b.x - a.x, b.y - a.y, b.z - a.z);
      if (tmpDir.lengthSq() > 1e-9) riderDir.copy(tmpDir.normalize());
      if (bikeRig) {
        bikeRig.setPose(riderDir, leanAt(points, i), dt);
        bikeRig.update(p0.speed, rideDelta);
      }
      // Segments drawn = point index (points 0..i need i segments).
      trailGeo.instanceCount = Math.max(0, Math.min(i, points.length - 1));

      const mode = camModeRef.current;
      if (mode === 'orbit') {
        camera.up.copy(UP_Y);
        controls.enabled = true;
        rider.visible = true;
        controls.update();
      } else {
        // Follow cams drive the camera directly; OrbitControls stays out.
        controls.enabled = false;
        camera.up.copy(UP_Z);
        rider.visible = mode !== 'cockpit';
        if (mode === 'chase') {
          // Real-scale chase: ~9 m behind, ~3 m up, eyes on the road ahead.
          const dist = 9;
          const height = 3.2;
          const hLen = Math.hypot(riderDir.x, riderDir.y) || 1;
          tmpDesired.set(
            rider.position.x - (riderDir.x / hLen) * dist,
            rider.position.y - (riderDir.y / hLen) * dist,
            rider.position.z + height
          );
          tmpLook.set(
            rider.position.x + riderDir.x * 18,
            rider.position.y + riderDir.y * 18,
            rider.position.z + riderDir.z * 18 + 1.2
          );
        } else if (mode === 'drone') {
          // Elevated trailing drone: ~26 m back, ~12 m up.
          const dist = 26;
          const height = 12;
          const hLen = Math.hypot(riderDir.x, riderDir.y) || 1;
          tmpDesired.set(
            rider.position.x - (riderDir.x / hLen) * dist,
            rider.position.y - (riderDir.y / hLen) * dist,
            rider.position.z + height
          );
          tmpLook.set(
            rider.position.x + riderDir.x * 12,
            rider.position.y + riderDir.y * 12,
            rider.position.z + 1.5
          );
        } else {
          // cockpit: eyes just above the bars, looking far down the road.
          const eyeH = 1.5;
          tmpDesired.set(rider.position.x, rider.position.y, rider.position.z + eyeH);
          tmpLook.set(
            rider.position.x + riderDir.x * 45,
            rider.position.y + riderDir.y * 45,
            rider.position.z + riderDir.z * 45 + eyeH * 0.6
          );
        }
        if (!followPosRef.current) followPosRef.current = tmpDesired.clone();
        const k = 1 - Math.exp(-dt * 4);
        followPosRef.current.lerp(tmpDesired, k);
        camera.position.copy(followPosRef.current);
        camera.lookAt(tmpLook);
      }
      sky.position.copy(camera.position);
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const onResize = () => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      if (w > 0 && h > 0) {
        renderer.setSize(w, h);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        // Line2 widths are resolution-dependent — keep both materials in sync.
        pathMat.resolution.set(w, h);
        trailMat.resolution.set(w, h);
      }
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(mount);

    sceneRef.current = { renderer, controls, camera, scene, grid, rider, bike: null, trail, pathGeo, roadGeo, home: { pos: homePos, target: homeTarget }, terrain: null };
    // The fresh scene has no terrain bed — refetch if the user had it on.
    if (terrainStateRef.current === 'on') setTerrainState('loading');

    const cleanup = () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      bikeCancelled = true;
      bikeRig?.dispose();
      renderer.domElement.removeEventListener('dblclick', onDblClick);
      controls.dispose();
      pathGeo.dispose();
      pathMat.dispose();
      trailGeo.dispose();
      trailMat.dispose();
      roadGeo?.dispose();
      roadMat?.dispose();
      roadTex?.dispose();
      markerGroup.children.forEach((child) => {
        if (child instanceof THREE.Sprite) child.material.map?.dispose();
        markerGroup.remove(child);
      });
      markerDisposables.forEach((d) => d.dispose());
      const terrainMesh = sceneRef.current?.terrain;
      if (terrainMesh) {
        scene.remove(terrainMesh);
        terrainMesh.geometry.dispose();
        (terrainMesh.material as THREE.Material).dispose();
      }
      dirLight.dispose?.();
      sky.geometry.dispose();
      (sky.material as THREE.MeshBasicMaterial).map?.dispose();
      (sky.material as THREE.Material).dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement === mount) mount.removeChild(renderer.domElement);
      sceneRef.current = null;
    };
    return cleanup;
  }, [points, totalTime, build.totalDistance, liteMode, startDate]);

  // Recolour the path line + road ribbon without rebuilding the scene.
  useEffect(() => {
    const s = sceneRef.current;
    if (!s?.pathGeo || points.length < 2) return;
    const colors = replayPathColorArray(points, colorBy);
    s.pathGeo.setColors(colors);
    const attr = s.roadGeo?.getAttribute('color') as THREE.BufferAttribute | undefined;
    if (attr && attr.count === points.length * 2) {
      const arr = attr.array as Float32Array;
      for (let i = 0; i < points.length; i++) {
        const c = i * 3;
        const o = i * 6;
        arr[o] = arr[o + 3] = colors[c];
        arr[o + 1] = arr[o + 4] = colors[c + 1];
        arr[o + 2] = arr[o + 5] = colors[c + 2];
      }
      attr.needsUpdate = true;
    }
  }, [colorBy, points]);

  const colorStats = useMemo(() => {
    const has = (f: (p: ReplayPoint) => number | null) => points.some((p) => f(p) != null);
    return {
      hasPower: has((p) => p.power),
      hasHr: has((p) => p.hr),
      hasGrade: has((p) => p.grade),
      maxPower: replayMetricScale(points, 'power'),
      maxHr: replayMetricScale(points, 'hr'),
    };
  }, [points]);

  // Fall back to speed when the selected metric has no data for this ride.
  useEffect(() => {
    if (colorBy === 'power' && !colorStats.hasPower) setColorBy('speed');
    else if (colorBy === 'hr' && !colorStats.hasHr) setColorBy('speed');
    else if (colorBy === 'grade' && !colorStats.hasGrade) setColorBy('speed');
  }, [colorBy, colorStats]);

  // Push display-elapsed to React ~10fps for the scrubber/readout too.
  // onElapsed (parent renders!) only fires when the half-second quantum
  // changes — silent when paused, ≤2fps during playback.
  const lastSentRef = useRef<number>(-1);
  useEffect(() => {
    const id = window.setInterval(() => {
      setDisplayElapsed(elapsedRef.current);
      const q = Math.floor(elapsedRef.current * 2) / 2;
      if (q !== lastSentRef.current) {
        lastSentRef.current = q;
        onElapsedRef.current?.(elapsedRef.current);
      }
    }, 100);
    return () => window.clearInterval(id);
  }, []);

  const terrainStateRef = useRef(terrainState);
  useEffect(() => {
    terrainStateRef.current = terrainState;
  }, [terrainState]);

  // ── Opt-in DEM terrain bed: fetched only when the user asks ────────────
  useEffect(() => {
    if (terrainState !== 'loading') return;
    if (!polyline) {
      setTerrainState('failed');
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    (async () => {
      try {
        const [{ fetchTerrainResult }, { computeGrid, buildTerrainMesh }] = await Promise.all([
          import('@/lib/terrain'),
          import('@/lib/route3d'),
        ]);
        const coords = decodePolyline(polyline);
        const gridSpec = computeGrid(coords);
        if (!gridSpec) throw new Error('no-grid');
        const result = await fetchTerrainResult(gridSpec, controller.signal);
        if (cancelled) return;
        const s = sceneRef.current;
        if (!s) return;
        // Flat rides (no altitude stream) sit at z=0 — base the bed on the
        // DEM minimum so the path rests on the terrain instead of under it.
        const hasAlt = points.some((p) => p.z !== 0);
        const finite = result.heights.filter(Number.isFinite);
        const demMin = finite.length ? Math.min(...finite) : 0;
        const meshData = buildTerrainMesh(result.grid, result.heights, {
          lat0: build.lat0,
          lng0: build.lng0,
          altMin: hasAlt ? build.altMin : demMin,
          zScale: build.zScale,
        });
        const geo = new THREE.PlaneGeometry(1, 1, result.grid.cols - 1, result.grid.rows - 1);
        geo.setAttribute('position', new THREE.BufferAttribute(meshData.positions, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(meshData.colors, 3));
        geo.computeVertexNormals();
        const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
        const mesh = new THREE.Mesh(geo, mat);
        // The scene may have rebuilt while fetching — attach to the live one.
        const live = sceneRef.current;
        if (!live || cancelled) {
          geo.dispose();
          mat.dispose();
          return;
        }
        if (live.terrain) {
          live.scene.remove(live.terrain);
          live.terrain.geometry.dispose();
          (live.terrain.material as THREE.Material).dispose();
        }
        live.scene.add(mesh);
        live.grid.visible = false;
        live.terrain = mesh;
        setTerrainState('on');
      } catch (err) {
        if (cancelled || (err instanceof DOMException && err.name === 'AbortError')) return;
        setTerrainState('failed');
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [terrainState, polyline, points, build]);

  const toggleTerrain = () => {
    if (terrainState === 'on') {
      const s = sceneRef.current;
      if (s?.terrain) {
        s.scene.remove(s.terrain);
        s.terrain.geometry.dispose();
        (s.terrain.material as THREE.Material).dispose();
        s.terrain = null;
      }
      if (s) s.grid.visible = true;
      setTerrainState('off');
    } else if (terrainState === 'off' || terrainState === 'failed') {
      setTerrainState('loading');
    }
  };

  const bounds = useMemo(() => {
    if (points.length < 2) return null;
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const zs = points.map((p) => p.z);
    return {
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minY: Math.min(...ys),
      maxY: Math.max(...ys),
      minZ: Math.min(...zs),
      maxZ: Math.max(...zs),
    };
  }, [points]);

  // View presets always drop back to free-orbit first (follow cams own the camera).
  const resetView = () => {
    const s = sceneRef.current;
    if (!s?.home) return;
    setCamMode('orbit');
    s.camera.up.set(0, 1, 0);
    s.camera.position.copy(s.home.pos);
    s.controls.target.copy(s.home.target);
    s.controls.update();
  };
  const topView = () => {
    const s = sceneRef.current;
    if (!s || !bounds) return;
    setCamMode('orbit');
    const span = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, 100);
    const bx = (bounds.minX + bounds.maxX) / 2;
    const by = (bounds.minY + bounds.maxY) / 2;
    s.camera.up.set(0, 1, 0);
    s.camera.position.set(bx, by, bounds.maxZ + span * 2);
    s.controls.target.set(bx, by, bounds.minZ);
    s.controls.update();
  };
  const trackRider = () => {
    const s = sceneRef.current;
    if (!s) return;
    setCamMode('orbit');
    s.controls.target.copy(s.rider.position);
    s.controls.update();
  };

  const seek = (t: number) => {
    const L = linkRef.current;
    const span = L?.span ?? totalTime;
    const c = Math.max(0, Math.min(span, t));
    elapsedRef.current = Math.min(c, totalTime);
    setDisplayElapsed(elapsedRef.current);
    L?.onScrub(c);
  };

  const toggle = () => {
    const L = linkRef.current;
    if (L) {
      L.onToggle();
      return;
    }
    if (!playing && elapsedRef.current >= totalTime - 0.01) elapsedRef.current = 0;
    setPlaying((p) => !p);
  };

  const pickRate = (r: number) => {
    linkRef.current?.onRate(r);
    setRate(r);
  };

  // Entering the tour: jump to the first highlight and start playing.
  useEffect(() => {
    if (!tour || !highlights.length) return;
    seek(highlights[0].startElapsed);
    if (!linkRef.current) setPlaying(true);
  }, [tour]);

  const takePoster = () => {
    const s = sceneRef.current;
    if (!s) return;
    s.renderer.render(s.scene, s.camera);
    s.renderer.domElement.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${name.replace(/[^\w-]+/g, '_').slice(0, 40) || 'ride'}-3d.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, 'image/png');
  };

  const km = (build.totalDistance / 1000).toFixed(1);
  const maxKmh = build.maxSpeed * 3.6;

  // Live telemetry at the playhead for the HUD chip (data already in points).
  const hud = useMemo(() => {
    if (!points.length) return null;
    const i = Math.max(0, Math.min(points.length - 1, nearestIndex(points, displayElapsed)));
    const p = points[i];
    return {
      kmh: p.speed * 3.6,
      power: p.power,
      hr: p.hr,
      cadence: p.cadence,
      grade: p.grade,
    };
  }, [points, displayElapsed]);

  // Active highlight at the playhead (tour caption + camera director).
  const activeHighlight = useMemo(
    () => (tour ? highlightAt(highlights, displayElapsed) : null),
    [tour, highlights, displayElapsed]
  );
  useEffect(() => {
    if (!tour || !activeHighlight) return;
    setCamMode(activeHighlight.kind === 'climb' ? 'drone' : 'chase');
  }, [tour, activeHighlight]);

  if (failed) {
    return (
      <p className="rounded border border-surface-light bg-surface/40 p-3 text-sm text-muted">
        3D view isn&apos;t available in this browser — the 2D map above is used instead.
      </p>
    );
  }

  return (
    <div className={`${theater ? '' : 'rounded border border-surface-light bg-surface/40 p-3'}`}>
      {!theater && (
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted uppercase tracking-wide">
        <span className="font-medium text-foreground">3D Flythrough</span>
        <span>{name}</span>
        <span className="ml-auto">{km} km · {timeFmt(totalTime)}</span>
      </div>
      )}

      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="flex items-center rounded border border-surface-light" role="group" aria-label="Camera mode">
          {(['orbit', 'chase', 'drone', 'cockpit'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setCamMode(m)}
              aria-pressed={camMode === m}
              title={
                m === 'orbit'
                  ? 'Free orbit camera'
                  : m === 'chase'
                    ? 'Follow behind the rider'
                    : m === 'drone'
                      ? 'Elevated trailing drone'
                      : 'Rider point of view'
              }
              className={`rounded px-2 py-1 min-h-[44px] min-w-[44px] text-xs capitalize transition-colors ${
                camMode === m ? 'bg-accent/20 text-accent' : 'text-muted hover:bg-surface-light/40'
              }`}
            >
              {m}
            </button>
          ))}
        </div>
        {highlights.length > 0 && (
          <button
            onClick={() => setTour((t) => !t)}
            aria-pressed={tour}
            title="Cinematic tour of this ride's highlights (climbs, descents, sprints)"
            className={`rounded border border-surface-light px-2 py-1 min-h-[44px] text-xs transition-colors hover:bg-surface-light/40 ${
              tour ? 'bg-accent/20 text-accent' : 'text-muted'
            }`}
          >
            {tour ? 'Touring' : 'Tour'}
          </button>
        )}
        {polyline && (
          <button
            onClick={toggleTerrain}
            disabled={terrainState === 'loading'}
            title="Drape the ride over real DEM terrain (extra download)"
            className={`rounded border border-surface-light px-2 py-1 min-h-[44px] text-xs transition-colors hover:bg-surface-light/40 disabled:opacity-50 ${
              terrainState === 'on' ? 'bg-accent/20 text-accent' : 'text-muted'
            }`}
          >
            {terrainState === 'on'
              ? 'Terrain on'
              : terrainState === 'loading'
                ? 'Loading terrain…'
                : terrainState === 'failed'
                  ? 'Retry terrain'
                  : 'Terrain'}
          </button>
        )}
        <div className="flex items-center rounded border border-surface-light" role="group" aria-label="View presets">
          {(
            [
              ['Reset', resetView, 'Restore the overview'],
              ['Top', topView, 'Plan view from above'],
              ['Rider', trackRider, 'Pivot around the rider'],
            ] as const
          ).map(([label, fn, title]) => (
            <button
              key={label}
              onClick={fn}
              title={title}
              className="rounded px-2 py-1 min-h-[44px] min-w-[44px] text-xs text-muted transition-colors hover:bg-surface-light/40"
            >
              {label}
            </button>
          ))}
        </div>
        <button
          onClick={takePoster}
          title="Download a PNG poster of the current view"
          className="rounded border border-surface-light px-2 py-1 min-h-[44px] text-xs text-muted transition-colors hover:bg-surface-light/40"
        >
          Poster
        </button>
      </div>

      <div className={`relative ${canvasHeightClass} w-full overflow-hidden rounded bg-gradient-to-b from-surface/20 to-transparent`}>
        <div ref={mountRef} className="absolute inset-0" />
        <div className="pointer-events-none absolute bottom-1 left-1 rounded bg-surface/70 px-1.5 py-0.5 text-[10px] text-muted">
          drag to orbit · pinch to zoom · double-click to focus
        </div>
        {activeHighlight && (
          <div className="pointer-events-none absolute bottom-2 left-1/2 max-w-[80%] -translate-x-1/2 rounded-lg border border-accent/30 bg-surface/85 px-3 py-1.5 text-center">
            <p className="text-xs font-semibold text-accent">{activeHighlight.label}</p>
            <p className="text-[11px] text-foreground">{activeHighlight.detail}</p>
          </div>
        )}
        {hud && (
          <div className="pointer-events-none absolute right-1 top-1 rounded bg-surface/70 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-foreground">
            {hud.kmh.toFixed(1)} km/h
            {hud.power != null && <span className="text-blue-400"> · {Math.round(hud.power)} W</span>}
            {hud.hr != null && <span className="text-amber-400"> · {Math.round(hud.hr)} bpm</span>}
            {hud.cadence != null && <span className="text-violet-400"> · {Math.round(hud.cadence)} rpm</span>}
            {hud.grade != null && (
              <span className="text-emerald-400"> · {hud.grade >= 0 ? '+' : ''}{hud.grade.toFixed(1)}%</span>
            )}
          </div>
        )}
      </div>

      {highlights.length > 0 && (
        <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1" role="group" aria-label="Ride highlights">
          {highlights.map((h, i) => (
            <button
              key={`${h.kind}-${i}`}
              onClick={() => {
                setTour(true);
                seek(h.startElapsed);
              }}
              title={h.detail}
              className={`shrink-0 rounded-full border px-3 py-1 min-h-[36px] text-[11px] transition-colors ${
                activeHighlight === h
                  ? 'border-accent/50 bg-accent/20 text-accent'
                  : 'border-surface-light text-muted hover:border-accent/30'
              }`}
            >
              {h.label}
            </button>
          ))}
        </div>
      )}

      {/* Path colour mode + scale */}
      <div className="mt-2 flex items-center gap-2">
        <div className="flex items-center rounded border border-surface-light" role="group" aria-label="Path colour metric">
          {(['speed', 'power', 'hr', 'grade'] as const).map((m) => {
            const available =
              m === 'speed' ||
              (m === 'power' && colorStats.hasPower) ||
              (m === 'hr' && colorStats.hasHr) ||
              (m === 'grade' && colorStats.hasGrade);
            return (
              <button
                key={m}
                onClick={() => setColorBy(m)}
                disabled={!available}
                title={available ? `Colour the path by ${m}` : `No ${m} data on this ride`}
                className={`rounded px-2 py-1 min-h-[44px] min-w-[44px] text-xs capitalize transition-colors disabled:opacity-30 ${
                  colorBy === m ? 'bg-accent/20 text-accent' : 'text-muted hover:bg-surface-light/40'
                }`}
              >
                {m === 'hr' ? 'HR' : m}
              </button>
            );
          })}
        </div>
        <div className="flex flex-1 flex-col gap-0.5" aria-hidden>
          <div
            className="h-1.5 w-full rounded-full"
            style={{ background: colorBy === 'grade' ? GRADE_GRADIENT : INTENSITY_GRADIENT }}
          />
          <div className="flex justify-between text-[10px] tabular-nums text-muted">
            <span>
              {colorBy === 'speed' && '0 km/h'}
              {colorBy === 'power' && '0 W'}
              {colorBy === 'hr' && '0 bpm'}
              {colorBy === 'grade' && '-12%'}
            </span>
            <span>
              {colorBy === 'speed' && `${maxKmh.toFixed(0)} km/h`}
              {colorBy === 'power' && `${Math.round(colorStats.maxPower)} W`}
              {colorBy === 'hr' && `${Math.round(colorStats.maxHr)} bpm`}
              {colorBy === 'grade' && '+12%'}
            </span>
          </div>
        </div>
      </div>

      <TelemetryStrip
        points={points}
        playhead={displayElapsed}
        elevationBase={{ altMin: build.altMin, zScale: build.zScale }}
        ftpWatts={ftpWatts}
      />
      {terrainState === 'on' && (
        <p className="mt-1 text-[10px] text-muted">Terrain © Open-Meteo — Copernicus DEM (GLO-90)</p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {link ? (
          <span
            title="Playback follows the compare master clock above"
            className="inline-flex min-h-[44px] items-center rounded bg-accent/20 px-3 py-1 text-sm font-medium text-accent"
          >
            Linked
          </span>
        ) : (
          <>
            <button
              onClick={toggle}
              className="rounded bg-accent px-3 py-1 min-h-[44px] text-sm font-medium text-accent-foreground transition-colors hover:bg-accent/90"
            >
              {playing ? 'Pause' : 'Play'}
            </button>
            <div className="flex items-center gap-1" role="group" aria-label="Playback speed">
              {tourOptions.map((o) => (
                <button
                  key={o.label}
                  onClick={() => pickRate(o.rate)}
                  title={`Whole ride in ~${o.label} (${o.rate}×)`}
                  className={`rounded px-2 py-1 min-h-[44px] min-w-[44px] text-xs transition-colors ${
                    rate === o.rate ? 'bg-accent/20 text-accent' : 'text-muted hover:bg-surface-light/40'
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </>
        )}
        <span className="ml-1 font-mono text-xs tabular-nums text-muted">
          {timeFmt(displayElapsed)} / {timeFmt(totalTime)}
        </span>
      </div>

      <input
        type="range"
        min={0}
        max={totalTime}
        step={0.1}
        value={displayElapsed}
        onChange={(e) => seek(Number(e.target.value))}
        aria-label="Replay scrubbing"
        className="mt-2 h-11 w-full accent-accent"
      />
    </div>
  );
}