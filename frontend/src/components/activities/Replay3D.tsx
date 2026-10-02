'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import type { ReplayBuildResult, ReplayColorMode, ReplayPoint } from '@/lib/replay';
import { TOUR_PRESETS, groundHeightAt, powerZoneBounds, replayDistanceAt, replayMetricColor, replayMetricScale, replayMetricValue, timeFmt, tourRate } from '@/lib/replay';
import { decodePolyline } from '@/lib/polyline';
import { DESCENT_COLOR, GRADE_RAMP, bilinearHeight, slopeColor } from '@/lib/route3d';
import { createBikeRig, leanFromCurvature, type BikeRig } from '@/lib/bike';
import { buildRoadRibbon } from '@/lib/road';
import { buildDirectorPath, pickAutoCameraMode, samplePath, seedOrbitShot, updateOrbitShot } from '@/lib/director';
import type { AutoCamMode, DirectorPath, OrbitShot, ReplayCamMode } from '@/lib/director';
import { buildShotPath, pickBeatShot, shotWantsOverview, type ShotKind } from '@/lib/shots';
import { ReplayToolbar } from './ReplayToolbar';
import { ReplayLoadingOverlay } from './ReplayLoadingOverlay';
import { detectHighlights, highlightAt, type HighlightKind } from '@/lib/highlights';
import { beatAt, detectBeats, type Beat } from '@/lib/beats';
import { nextEvent } from '@/lib/tour';
import { applyWeatherLight, daylightPhase, solarPosition, sunDirection, sunLightModel } from '@/lib/sun';
import { atmosphereFactors, createAtmosphereDome, updateAtmosphereDome } from '@/lib/sky';
import { CLOUD_LIT, CLOUD_SHADE, cloudFactors, cloudWindVec, createCloudDome, tickCloudDome, updateCloudDome } from '@/lib/clouds';
import { GodRaysShader, sunScreenPosition } from '@/lib/godrays';
import { DofShader, dofSettingsFor, syncDofTarget, type DofTarget } from '@/lib/dof';
import { createRideAudio, type RideAudio } from '@/lib/audio';
import { createPerfBudget, perfNeedsDegrade, perfObserve, prefersReducedMotion } from '@/lib/perf';
import type { RouteGrid } from '@/lib/route3d';
import type { RaceRide } from '@/lib/raceRides';
import { raceIndexAt, speedColor } from '@/lib/raceRides';
import { classifyWeather, parseCardinal } from '@/lib/three/weather';

/** practical headlamp strength at full darkness (physical units, tuned by eye) */
const HEADLAMP_MAX = 60;

/** shared weather-flag derivation for scene setup + time scrubber */
function weatherFlags(weather: { conditions?: string | null; precipitationMm?: number | null } | null) {
  const { cond, precip, rainy, snowy, foggy, overcast, wetness, weatherType, precipIntensity } = classifyWeather(weather?.conditions, weather?.precipitationMm);
  return { cond, precip, rainy, snowy, foggy, overcast, wetness, weatherType, precipIntensity };
}

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

/** Coggan power-zone color for a given wattage (matches broadcast HUD power row). */
function powerZoneColor(watts: number, ftpWatts?: number | null): string {
  const zones = powerZoneBounds(ftpWatts ?? 200);
  let z = 0;
  while (z < zones.length && watts >= zones[z]) z++;
  return ZONE_COLORS[Math.min(z, ZONE_COLORS.length - 1)];
}

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

/** soft radial blob used as the bike's contact shadow */
function createSoftShadowTexture(): THREE.Texture {
  const s = 128;
  const canvas = document.createElement('canvas');
  canvas.width = s;
  canvas.height = s;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.4)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Lift effort colours toward asphalt grey so the road reads as a road. Pure. */
function roadTint(colors: number[], amount = 0.5): number[] {
  const out = new Array<number>(colors.length);
  for (let i = 0; i < colors.length; i += 3) {
    out[i] = amount + (1 - amount) * colors[i];
    out[i + 1] = amount + (1 - amount) * colors[i + 1];
    out[i + 2] = amount + (1 - amount) * colors[i + 2];
  }
  return out;
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
    ctx.strokeStyle = 'rgba(240,244,250,0.85)';
    ctx.lineWidth = 2;
    ctx.setLineDash([32, 96]);
    ctx.beginPath();
    ctx.moveTo(s / 2, 0);
    ctx.lineTo(s / 2, s);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(226,232,240,0.45)';
    ctx.lineWidth = 3;
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



/** index of the point whose cumulative distance is closest to `d` */
function nearestByDistance(points: ReplayPoint[], d: number): number {
  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].distance < d) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(points[lo - 1].distance - d) < Math.abs(points[lo].distance - d)) lo--;
  return lo;
}

/**
 * Elevation profile used as the Theater scrubber — a filled area over the ride
 * with a playhead; click/drag anywhere to seek. Coloured by grade.
 */
function CourseProfile({
  points,
  totalDistance,
  elapsed,
  onSeek,
}: {
  points: ReplayPoint[];
  totalDistance: number;
  elapsed: number;
  onSeek: (t: number) => void;
}) {
  const W = 100;
  const H = 24;
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragging = useRef(false);

  const { areaPath, linePath } = useMemo(() => {
    if (points.length < 2 || totalDistance <= 0) return { areaPath: '', linePath: '' };
    let zMin = Infinity;
    let zMax = -Infinity;
    for (const p of points) {
      if (p.z < zMin) zMin = p.z;
      if (p.z > zMax) zMax = p.z;
    }
    const zSpan = zMax - zMin || 1;
    const sx = (d: number) => (d / totalDistance) * W;
    const sy = (z: number) => H - ((z - zMin) / zSpan) * (H - 3) - 1.5;
    let line = `M ${sx(points[0].distance).toFixed(2)} ${sy(points[0].z).toFixed(2)}`;
    for (let i = 1; i < points.length; i++) {
      line += ` L ${sx(points[i].distance).toFixed(2)} ${sy(points[i].z).toFixed(2)}`;
    }
    return { linePath: line, areaPath: `${line} L ${W} ${H} L 0 ${H} Z` };
  }, [points, totalDistance]);

  const curDist = replayDistanceAt(points, elapsed);
  const px = totalDistance > 0 ? Math.max(0, Math.min(W, (curDist / totalDistance) * W)) : 0;

  const seekFromClientX = (clientX: number) => {
    const el = svgRef.current;
    if (!el || totalDistance <= 0) return;
    const rect = el.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / (rect.width || 1)));
    onSeek(points[nearestByDistance(points, frac * totalDistance)].elapsed);
  };

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      role="slider"
      aria-label="Course elevation profile — click to seek"
      aria-valuemin={0}
      aria-valuemax={Math.round(totalDistance)}
      aria-valuenow={Math.round(curDist)}
      className="mt-2 h-20 sm:h-14 w-full cursor-crosshair touch-none select-none"
      onPointerDown={(e) => {
        dragging.current = true;
        (e.target as Element).setPointerCapture?.(e.pointerId);
        seekFromClientX(e.clientX);
      }}
      onPointerMove={(e) => {
        if (dragging.current) seekFromClientX(e.clientX);
      }}
      onPointerUp={() => {
        dragging.current = false;
      }}
    >
      <path d={areaPath} className="fill-accent/20" />
      <path d={linePath} className="fill-none stroke-accent" strokeWidth={0.5} vectorEffect="non-scaling-stroke" />
      <line x1={px} x2={px} y1={0} y2={H} className="stroke-foreground" strokeWidth={0.5} vectorEffect="non-scaling-stroke" />
    </svg>
  );
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
  ghost = null,
  terrainDefault = true,
  weather = null,
  race = null,
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
  /** ghost ride for a race overlay (Phase 5) — time-aligned with the rider */
  ghost?: { build: ReplayBuildResult; name?: string } | null;
  /** fetch the DEM terrain bed on mount (default true; compare modal opts out) */
  terrainDefault?: boolean;
  /** ride weather — tints the sky/fog and lighting (rain/overcast/snow/fog) */
  weather?: {
    conditions?: string | null;
    temperature?: number | null;
    windSpeedKmh?: number | null;
    windDirection?: string | null;
    precipitationMm?: number | null;
  } | null;
  /** "Race Yourself" — other rides on the same route, drawn as coloured traces */
  race?: RaceRide[] | null;
}) {
  const points = build.points;
  const totalTime = build.totalTime;

  // ── Route extent: bounding box + principal direction (PCA on the path) ───
  // Used by the orbit camera to frame an elliptical path that hugs the route
  // shape instead of wasting half the view on a long thin out-and-back.
  useEffect(() => {
    const n = points.length;
    if (n < 2) { routeExtentRef.current = null; return; }
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    let cx = 0, cy = 0;
    for (const p of points) {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
      cx += p.x; cy += p.y;
    }
    cx /= n; cy /= n;
    // Covariance (variance along x, y + covariance) → principal eigenvector.
    let sxx = 0, syy = 0, sxy = 0;
    for (const p of points) {
      const dx = p.x - cx, dy = p.y - cy;
      sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
    }
    // Eigenvector of largest eigenvalue: angle of the route's long axis.
    const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    // Extent projected onto the principal axes.
    let ru = 0, rv = 0;
    for (const p of points) {
      const dx = p.x - cx, dy = p.y - cy;
      const u = dx * Math.cos(theta) + dy * Math.sin(theta);
      const v = -dx * Math.sin(theta) + dy * Math.cos(theta);
      ru = Math.max(ru, Math.abs(u)); rv = Math.max(rv, Math.abs(v));
    }
    // Half-extents, clamped so a near-symmetric route still gets a circle.
    const ru2 = Math.max(8, ru), rv2 = Math.max(8, rv);
    routeExtentRef.current = { rx: ru2, ry: rv2, dirX: Math.cos(theta), dirY: Math.sin(theta) };
  }, [points]);

  // Lite mode: auto-on for small screens (no MSAA, pixel ratio 1) unless forced.
  const liteMode = lite ?? (typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches);

  // Auto-tour highlights (Phase 4) — computed once per path.
  const highlights = useMemo(() => detectHighlights(points), [points]);

  const mountRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  // True from mount until the first scene frame renders (covers the WebGL
  // setup gap where terrainState hasn't started loading yet).
  const [sceneReady, setSceneReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(() => tourRate(totalTime, 300));
  const [displayElapsed, setDisplayElapsed] = useState(0);
  const [camMode, setCamMode] = useState<ReplayCamMode>('auto');
  // Auto-camera state: the currently selected sub-mode and a cooldown timer so
  // we don't flip cameras every frame.
  const autoCamRef = useRef<{ mode: AutoCamMode; until: number }>({ mode: 'orbit', until: 0 });
  // Resolved per-frame camera mode ('auto' unwrapped). Scene logic, the HUD
  // badge and click-to-seek all read this — never the raw camMode, which stays
  // 'auto' while the director switches underneath.
  const resolvedModeRef = useRef<ReplayCamMode>('orbit');
  const [resolvedAuto, setResolvedAuto] = useState<AutoCamMode>('orbit');
  const [colorBy, setColorBy] = useState<ReplayColorMode>('speed');
  const [terrainState, setTerrainState] = useState<'off' | 'loading' | 'on' | 'failed'>(() => {
    if (!terrainDefault) return 'off';
    return typeof window !== 'undefined' && window.localStorage?.getItem('relive:terrain') === 'off' ? 'off' : 'loading';
  });
  // Bumped whenever the scene is rebuilt so the terrain bed is re-attached.
  const [terrainEpoch, setTerrainEpoch] = useState(0);
  const [terrainAttribution, setTerrainAttribution] = useState<string>('');
  // Tile-loading progress for the loading overlay (loaded/total), so the user
  // sees real progress instead of an indeterminate spinner.
  const [loadProgress, setLoadProgress] = useState<{ loaded: number; total: number } | null>(null);
  const loadProgressRef = useRef<{ loaded: number; total: number }>({ loaded: 0, total: 0 });
  const [imageryState, setImageryState] = useState<'off' | 'loading' | 'on' | 'failed'>(() => {
    // Auto-load for the cinematic intro (satellite looks great from height);
    // reverted to 'off' at the chase hand-off. Compare modal (no terrain) and
    // users who explicitly saved 'off' opt out.
    if (!terrainDefault) return 'off';
    const saved = typeof window !== 'undefined' ? window.localStorage?.getItem('relive:imagery') : null;
    if (saved === 'off') return 'off';
    return 'loading';
  });
  const [imageryAttribution, setImageryAttribution] = useState<string>('');
  const [tour, setTour] = useState(false);
  // Photo mode: hide the chrome for a clean view / capture.
  const [photo, setPhoto] = useState(false);
  // Broadcast HUD: full ride-data overlay (pro cycling broadcast style).
  const [showBroadcast, setShowBroadcast] = useState(false);
  // Day/night scrubber: hours offset from the ride's start time (re-lights).
  const [timeOffsetH, setTimeOffsetH] = useState(0);
  // Per-point DEM height so the road/bike follow the terrain bed instead of the
  // raw barometric profile. Null = undraped.
  const [drapeZ, setDrapeZ] = useState<number[] | null>(null);
  const drapeZRef = useRef<number[] | null>(null);

  const sceneRef = useRef<{
    renderer: THREE.WebGLRenderer;
    controls: OrbitControls;
    camera: THREE.PerspectiveCamera;
    scene: THREE.Scene;
    grid: THREE.GridHelper;
    rider: THREE.Object3D;
    bike: BikeRig | null;
    trail: Line2;
    path: Line2;
    pathGeo: LineGeometry | null;
    roadGeo: THREE.BufferGeometry | null;
    roadMat: THREE.MeshPhongMaterial | null;
    home: { pos: THREE.Vector3; target: THREE.Vector3 } | null;
    terrain: THREE.Mesh | null;
    composer: EffectComposer | null;
    rays: ShaderPass | null;
    dof: (DofTarget & { depth: THREE.MeshDepthMaterial }) | null;
    dirLight: THREE.DirectionalLight | null;
    sky: THREE.Mesh | null;
    cloud: THREE.Mesh | null;
    hemiLight: THREE.HemisphereLight | null;
    headlamp: THREE.PointLight | null;
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
  // Smoothed look target for follow cams (prevents jitter on heading changes).
  const lookTargetRef = useRef<THREE.Vector3 | null>(null);
  // Cinematic auto-orbit state: orbit angle, radius, user-interaction timer, and
  // a smoothed "auto" camera pose that eases in/out so manual drag feels native.
  const orbitAutoRef = useRef<{
    lastInteract: number; // performance.now() of last user drag
    enabled: boolean; // auto-orbit active (paused briefly after manual override)
    bankAngle: number; // smoothed camera roll (radians) for banking into turns
    /** shot director state; null until seeded from a valid rider position */
    shot: OrbitShot | null;
  }>({
    lastInteract: 0,
    enabled: true,
    bankAngle: 0,
    shot: null,
  });
  // Previous-frame heading for camera banking (yaw rate → roll).
  const prevHeadingRef = useRef<THREE.Vector3 | null>(null);
  // Route extent for aspect-adaptive orbit framing: the route's bounding box
  // (meters) and its principal direction, so the elliptical orbit fills the frame
  // instead of wasting space on a long thin route.
  const routeExtentRef = useRef<{ rx: number; ry: number; dirX: number; dirY: number } | null>(null);
  // True for one tick after cinematic → orbit handoff, so the orbit eases in
  // immediately instead of waiting out the resume delay.
  const orbitJustHandedOffRef = useRef(false);
  // Current active highlight (read in the RAF tick for auto-camera context).
  const activeHighlightRef = useRef<{ startElapsed: number; endElapsed: number; label: string; detail: string; kind: HighlightKind } | null>(null);
  // Current sun direction in the replay frame, read per-frame (god-rays
  // screen projection). Updated at setup and by the time-of-day scrubber.
  const sunDirRef = useRef<[number, number, number]>([0.5, -0.5, 0.8]);
  // God-rays toggle (Lite mode has no rays pass at all — see scene setup).
  const [raysOn, setRaysOn] = useState(true);
  const raysOnRef = useRef(true);
  // Depth-of-field toggle. Default OFF: an unaudited blur must never touch a
  // real session — the tick owns `pass.enabled` outright from this ref, so
  // off means byte-identical rendering to before (no prepass even runs).
  const [dofOn, setDofOn] = useState(false);
  const dofOnRef = useRef(false);
  useEffect(() => {
    dofOnRef.current = dofOn;
  }, [dofOn]);
  useEffect(() => {
    raysOnRef.current = raysOn;
    const r = sceneRef.current?.rays;
    if (r) r.enabled = raysOn;
  }, [raysOn]);
  // Adaptive performance: one-shot reduced profile + badge for its fps.
  const [perfMode, setPerfMode] = useState<'full' | 'reduced'>('full');
  const [perfFps, setPerfFps] = useState<number | null>(null);
  const perfReducedRef = useRef(false);
  // Reduced motion: hold ambient camera motion still for users who ask the OS
  // for it (auto-orbit drift, banking, streaks, cloud drift). Ride playback,
  // weather and explicit camera choices are unaffected.
  const reducedMotionRef = useRef(false);
  useEffect(() => {
    reducedMotionRef.current = prefersReducedMotion();
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    reducedMotionRef.current = mq.matches;
    const onChange = (e: MediaQueryListEvent) => {
      reducedMotionRef.current = e.matches;
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  // Ride audio: engine lives across toggles (rebuilt noise is expensive);
  // created on the toggle gesture only (autoplay policy). Default off.
  const audioRef = useRef<RideAudio | null>(null);
  const audioAccRef = useRef(0);
  const [audioOn, setAudioOn] = useState(false);
  const toggleAudio = () => {
    if (!audioOn) {
      if (!audioRef.current) audioRef.current = createRideAudio();
      if (!audioRef.current) return; // no Web Audio — stay off, not stuck on
      audioRef.current.setActive(true);
      setAudioOn(true);
    } else {
      audioRef.current?.setActive(false);
      setAudioOn(false);
    }
  };
  // A hidden tab stops RAF but not audio — suspend, resume only if still on.
  useEffect(() => {
    const onVis = () => audioRef.current?.setActive(!document.hidden && audioOn);
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [audioOn]);
  // Engine lifetime is the component, not the scene: terrain-drape rebuilds
  // tear the scene down mid-ride and must never take audio with them.
  useEffect(
    () => () => {
      audioRef.current?.dispose();
      audioRef.current = null;
    },
    []
  );
  // Ride-time weather, read per-frame (wet road sheen + wind HUD).
  const wetnessRef = useRef(0);
  const windSpeedRef = useRef(0);
  const windDirRef = useRef<string | null>(null);
  // True when the cinematic intro auto-enabled satellite imagery (revert on hand-off).
  const cinematicImageryRef = useRef(false);
  const followPosRef = useRef<THREE.Vector3 | null>(null);

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);
  useEffect(() => {
    rateRef.current = rate;
  }, [rate]);
  // Day/night scrubber: recompute the continuous sun model when the offset
  // changes, updating the live scene's lights, sky dome, fog, exposure and
  // headlamp. Same model + weather as scene setup, so scrubbing never pops.
  useEffect(() => {
    const s = sceneRef.current;
    if (!s || !s.dirLight || !s.sky || !s.hemiLight) return;
    const sunDate = startDate ? new Date(new Date(startDate).getTime() + timeOffsetH * 3600_000) : null;
    if (!sunDate || Number.isNaN(sunDate.valueOf())) return;
    const sun = solarPosition(sunDate, build.lat0, build.lng0);
    const { rainy, snowy, foggy, overcast } = weatherFlags(weather);
    const L = applyWeatherLight(sunLightModel(sun.elevationDeg), { overcast, rainy, snowy, foggy });
    // Update lights
    s.dirLight.color.setHex(L.sunColor);
    s.dirLight.intensity = L.sunIntensity;
    s.hemiLight.color.setHex(L.hemiSky);
    s.hemiLight.intensity = L.hemiIntensity;
    if (s.headlamp) s.headlamp.intensity = L.headlamp * HEADLAMP_MAX;
    s.renderer.toneMappingExposure = L.exposure;
    if (s.scene.fog) (s.scene.fog as THREE.Fog).color.set(L.fog);
    // Update sun direction
    const sd = sunDirection(sun);
    sunDirRef.current = sd;
    const size = 1000; // arbitrary scale — the tick repositions relative to the bike
    s.dirLight.position.set(sd[0] * size, sd[1] * size, Math.max(0.2, sd[2]) * size);
    // Update the atmosphere dome — uniforms only, no texture rebuild, so
    // scrubbing the time of day stays cheap enough to drag live.
    updateAtmosphereDome(s.sky, {
      sunDirection: sunDirection(sun),
      skyTop: L.skyTop,
      skyHorizon: L.skyHorizon,
      fog: L.fog,
      ...atmosphereFactors(sun.elevationDeg, { overcast, rainy, snowy, foggy }),
    });
    // Clouds follow the sun too (silver lining + warmth move with it).
    if (s.cloud) {
      const cf = cloudFactors(sun.elevationDeg, { overcast, rainy, snowy, foggy });
      updateCloudDome(s.cloud, {
        sunDirection: sunDirection(sun),
        baseColor: CLOUD_LIT,
        darkColor: CLOUD_SHADE,
        fog: L.fog,
        nightFactor: atmosphereFactors(sun.elevationDeg, null).nightFactor,
        coverage: cf.coverage,
        opacity: cf.opacity,
        silver: cf.silver,
        warmth: cf.warmth,
        wind: cloudWindVec(windSpeedRef.current, windDirRef.current),
      });
    }
  }, [timeOffsetH, startDate, build.lat0, build.lng0]);

  // Tour default follows the ride length (not a stale fixed 4×).
  useEffect(() => {
    setRate(tourRate(totalTime, 300));
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
    // Leaving shot mode abandons any in-flight scripted path (its handoff is
    // moot once the user or director has moved on).
    if (camMode !== 'shot') {
      shotPathRef.current = null;
      shotKindRef.current = null;
    }
    // Re-seed follow smoothing from wherever the orbit camera is now.
    followPosRef.current = null;
    lookTargetRef.current = null;
    // Entering orbit: reset per-orbit state. The shot is seeded lazily on the
    // first ready tick (rider position is only valid after poseAt runs in the
    // RAF loop — reading it here would seed a bogus angle).
    if (camMode === 'orbit') {
      prevHeadingRef.current = null; // avoid bank spike from stale heading
      orbitAutoRef.current.shot = null;
      orbitAutoRef.current.bankAngle = 0;
    }
  }, [camMode]);

  // Cinematic intro auto-enables satellite imagery (default 'loading') and the
  // handoff reverts it — but only when the *intro* enabled it, never a manual
  // user choice (tracked separately, since the toggle and the handoff race).
  const userImageryToggledRef = useRef(false);
  useEffect(() => {
    cinematicImageryRef.current = imageryStateRef.current === 'loading';
  }, []);
  // Tour-only scripted shot playback (shot library — never user-selectable).
  const shotPathRef = useRef<DirectorPath | null>(null);
  const shotStartRef = useRef(0);
  const shotKindRef = useRef<ShotKind | null>(null);
  const preShotModeRef = useRef<ReplayCamMode>('auto');

  // Build the three.js scene once for this ride.
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || build.points.length < 2) {
      setFailed(true);
      return;
    }
    // Drape the scene onto the DEM once loaded: the road + bike follow the
    // terrain bed; falls back to the raw barometric profile when terrain is off.
    let points = build.points;
    if (drapeZ && drapeZ.length === build.points.length) {
      points = build.points.map((p, i) => (p.z === drapeZ[i] ? p : { ...p, z: drapeZ[i] }));
    }

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: !liteMode,
        alpha: true,
        preserveDrawingBuffer: true,
        // km-scale scenes with near~0.5m need log depth or the terrain z-fights
        logarithmicDepthBuffer: true,
      });
      if (!renderer.getContext()) throw new Error('no-webgl');
    } catch {
      setFailed(true);
      return;
    }
    renderer.setPixelRatio(liteMode ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = !liteMode;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const scene = new THREE.Scene();
    // Styled world lit for the ride's actual time of day — continuous sun model
    // (no phase cliffs) with weather on top. See lib/sun.
    const sunDate = startDate ? new Date(startDate) : null;
    const sun = sunDate && !Number.isNaN(sunDate.valueOf()) ? solarPosition(sunDate, build.lat0, build.lng0) : null;
    const { rainy, snowy, foggy, overcast, wetness, weatherType, precipIntensity } =
      weatherFlags(weather);
    const windSpeed = weather?.windSpeedKmh ?? 0;
    const windDir = weather?.windDirection ?? null;
    // Wetness 0..1 drives the road sheen (rain/snow accumulation).
    wetnessRef.current = wetness;
    windSpeedRef.current = windSpeed;
    windDirRef.current = windDir;
    const L = applyWeatherLight(sunLightModel(sun ? sun.elevationDeg : 45), { overcast, rainy, snowy, foggy });
    const FOG_COLOR = new THREE.Color(L.fog);
    const sunIntensity = L.sunIntensity;
    const hemiIntensity = L.hemiIntensity;
    let fogFarScale = 1;
    if (rainy) fogFarScale = 0.5;
    if (snowy) fogFarScale = 0.6;
    if (foggy) fogFarScale = 0.35;
    const exposure = L.exposure;
    renderer.toneMappingExposure = exposure;
    const hemiLight = new THREE.HemisphereLight(L.hemiSky, 0x0a0f1a, hemiIntensity);
    scene.add(hemiLight);
    const dirLight = new THREE.DirectionalLight(L.sunColor, sunIntensity);
    scene.add(dirLight.target);
    if (!liteMode) {
      // Small frustum that follows the bike — a 20 km frustum would have no
      // usable resolution for a 1.7 m bike.
      dirLight.castShadow = true;
      dirLight.shadow.mapSize.set(1024, 1024);
      dirLight.shadow.camera.near = 1;
      dirLight.shadow.camera.far = 90;
      dirLight.shadow.camera.left = -18;
      dirLight.shadow.camera.right = 18;
      dirLight.shadow.camera.top = 18;
      dirLight.shadow.camera.bottom = -18;
      dirLight.shadow.bias = -0.0006;
      dirLight.shadow.normalBias = 0.05;
    }
    const grid = new THREE.GridHelper(2, 24, 0x334155, 0x1e293b);
    scene.add(grid);

    // Loop-based extrema — `Math.min(...points.map(...))` overflows the call
    // stack on rides with 10k+ samples (long cycling/gravel events).
    let minX = points[0].x, maxX = points[0].x;
    let minY = points[0].y, maxY = points[0].y;
    let minZ = points[0].z, maxZ = points[0].z;
    for (let i = 1; i < points.length; i++) {
      const p = points[i];
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    }
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const size = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 100);

    // Analytic atmosphere dome (follows the camera) + distance fog tuned to
    // the ride. Driven by the same sun model as the lights, so the sky and
    // the lighting can never disagree about the time of day.
    const sky = createAtmosphereDome(size * 4);
    {
      const factors = atmosphereFactors(sun ? sun.elevationDeg : 45, { overcast, rainy, snowy, foggy });
      const skySun: [number, number, number] = sun ? sunDirection(sun) : [0.5, -0.5, 0.8];
      updateAtmosphereDome(sky, {
        sunDirection: skySun,
        skyTop: L.skyTop,
        skyHorizon: L.skyHorizon,
        fog: L.fog,
        ...factors,
      });
    }
    scene.add(sky);
    // Procedural cloud shell inside the sky dome (skipped in Lite mode — a
    // fullscreen fbm layer is the wrong trade on small screens). Coverage
    // follows the ride weather; drift follows the ride wind.
    let cloud: THREE.Mesh | null = null;
    if (!liteMode) {
      cloud = createCloudDome(size * 3.4);
      const cf = cloudFactors(sun ? sun.elevationDeg : 45, { overcast, rainy, snowy, foggy });
      const skySun: [number, number, number] = sun ? sunDirection(sun) : [0.5, -0.5, 0.8];
      updateCloudDome(cloud, {
        sunDirection: skySun,
        baseColor: CLOUD_LIT,
        darkColor: CLOUD_SHADE,
        fog: L.fog,
        nightFactor: atmosphereFactors(sun ? sun.elevationDeg : 45, null).nightFactor,
        coverage: cf.coverage,
        opacity: cf.opacity,
        silver: cf.silver,
        warmth: cf.warmth,
        wind: cloudWindVec(windSpeed, windDir),
      });
      scene.add(cloud);
    }
    scene.fog = new THREE.Fog(FOG_COLOR.getHex(), size * 0.4, size * 3.2 * fogFarScale);

    // ── Weather particles: rain streaks, snow, or clear ─────────────────────
    // A GPU point/line system in camera-relative space. Intensity scales with
    // precipitation; wind tilts the fall direction. Rain = streaks (LineSegments),
    // snow = slow drifting points, dust/haze = sparse floating motes.
    let weatherFx: THREE.Points | THREE.LineSegments | null = null;
    if (weatherType) {
      if (weatherType === 'rain') {
        const N = Math.round(1400 * precipIntensity);
        const pos = new Float32Array(N * 6);
        for (let i = 0; i < N; i++) {
          const x = (Math.random() - 0.5) * 80;
          const y = (Math.random() - 0.5) * 80;
          const z = Math.random() * 50;
          pos[i * 6] = x;
          pos[i * 6 + 1] = y;
          pos[i * 6 + 2] = z;
          pos[i * 6 + 3] = x + 0.6;
          pos[i * 6 + 4] = y;
          pos[i * 6 + 5] = z - 2.2;
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        const mat = new THREE.LineBasicMaterial({
          color: 0xc8daf0,
          transparent: true,
          opacity: 0.5 * precipIntensity,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        weatherFx = new THREE.LineSegments(geo, mat);
      } else {
        // Snow or haze: soft drifting points.
        const N = weatherType === 'snow' ? Math.round(1800 * precipIntensity) : 500;
        const pos = new Float32Array(N * 3);
        const sizes = new Float32Array(N);
        for (let i = 0; i < N; i++) {
          pos[i * 3] = (Math.random() - 0.5) * 90;
          pos[i * 3 + 1] = (Math.random() - 0.5) * 90;
          pos[i * 3 + 2] = Math.random() * 55;
          sizes[i] = weatherType === 'snow' ? 0.5 + Math.random() * 1.2 : 0.3 + Math.random() * 0.6;
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
        const mat = new THREE.PointsMaterial({
          color: weatherType === 'snow' ? 0xffffff : 0x8a93a6,
          size: 1.4,
          sizeAttenuation: true,
          transparent: true,
          opacity: weatherType === 'snow' ? 0.85 * precipIntensity : 0.25,
          depthWrite: false,
          blending: weatherType === 'snow' ? THREE.NormalBlending : THREE.AdditiveBlending,
        });
        weatherFx = new THREE.Points(geo, mat);
      }
      weatherFx.frustumCulled = false;
      scene.add(weatherFx);
    }
    // Wind vector (meteorological "from" → "to" direction) for tilting particles.
    const windDeg = parseCardinal(windDirRef.current);
    const windRad = ((windDeg + 180) % 360) * (Math.PI / 180);
    const windVec = new THREE.Vector3(Math.sin(windRad), 0, 0).multiplyScalar(Math.min(8, (windSpeed ?? 0) * 0.15));

    const camera = new THREE.PerspectiveCamera(
      55,
      mount.clientWidth / mount.clientHeight,
      0.3,
      size * 8
    );

    // Post: god-rays → bloom → output. (Depth of field was removed: BokehPass
    // decodes its depth prepass with perspective math, but this renderer uses
    // logarithmicDepthBuffer for the km-scale terrain — the CoC came out
    // garbage and the whole frame stayed blurry. God-rays are depth-free by
    // construction, so they don't share that failure mode.)
    let composer: EffectComposer | null = null;
    let godRaysPass: ShaderPass | null = null;
    let dof: { pass: ShaderPass; rt: THREE.WebGLRenderTarget; depth: THREE.MeshDepthMaterial } | null = null;
    if (!liteMode) {
      composer = new EffectComposer(renderer);
      composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      composer.setSize(mount.clientWidth, mount.clientHeight);
      composer.addPass(new RenderPass(scene, camera));
      // DOF depth prepass target at half resolution (blur is forgiving).
      // Owned + disposed here — the composer never sees it.
      const dofRt = new THREE.WebGLRenderTarget(2, 2);
      const dofDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
      const dofPass = new ShaderPass(DofShader);
      dofPass.uniforms.tDepth.value = dofRt.texture;
      dofPass.uniforms.uNear.value = camera.near;
      dofPass.uniforms.uFar.value = camera.far;
      dof = { pass: dofPass, rt: dofRt, depth: dofDepth };
      syncDofTarget(dof, mount.clientWidth, mount.clientHeight, renderer.getPixelRatio());
      composer.addPass(dofPass);
      godRaysPass = new ShaderPass(GodRaysShader);
      godRaysPass.enabled = raysOnRef.current;
      composer.addPass(godRaysPass);
      // Restrained bloom: threshold 1.0 so only true HDR sources (sun glints,
      // headlamp pool, bright paint) bloom, with modest strength/radius so the
      // glow stays local — the old 0.6/0.5 smeared close-range brights (white
      // bike, dashes) across the whole frame in follow cams.
      composer.addPass(new UnrealBloomPass(new THREE.Vector2(mount.clientWidth, mount.clientHeight), 0.3, 0.4, 1.0));
      composer.addPass(new OutputPass());
    }

    // ── Speed streaks: motion particles trailing the bike ──────────────────
    // A pool of points that stream backward from the rider along its recent
    // path. Density and length scale with speed — barely visible when crawling,
    // dramatic sprint lines at pace. Tinted by the current effort (power/HR).
    const STREAK_COUNT = 400;
    const streakPos = new Float32Array(STREAK_COUNT * 3);
    // Per-vertex fade (1 near the bike → 0 at the tail). PointsMaterial has no
    // per-vertex alpha, but with additive blending a dark vertex colour reads
    // as transparent — the material colour tints, this attribute fades.
    const streakCol = new Float32Array(STREAK_COUNT * 3);
    const streakGeo = new THREE.BufferGeometry();
    streakGeo.setAttribute('position', new THREE.BufferAttribute(streakPos, 3));
    streakGeo.setAttribute('color', new THREE.BufferAttribute(streakCol, 3));
    const streakMat = new THREE.PointsMaterial({
      size: 0.9,
      transparent: true,
      opacity: 0.5,
      vertexColors: true,
      color: 0x38bdf8,
      sizeAttenuation: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const streaks = new THREE.Points(streakGeo, streakMat);
    streaks.frustumCulled = false;
    scene.add(streaks);
    // Ring buffer of recent rider positions for streak spawning.
    const streakHistory: { x: number; y: number; z: number; speed: number }[] = [];

    // Cinematic director: a scripted camera path that plays on open / on demand,
    // then hands off to a normal follow cam.
    const directorPath = buildDirectorPath(build, { introSeconds: 9 });
    // The cinematic clock doesn't start until the terrain bed (and imagery, if
    // loading) is ready — otherwise the camera sweeps over a bare grid.
    let cinematicStart = -1; // -1 = not started yet
    const CINEMATIC_HOLD = 1.5; // seconds to hold the final frame before handing off
    grid.rotation.x = Math.PI / 2;
    grid.scale.setScalar(size / 2);
    grid.position.set(cx, cy, Math.max(minZ - size * 0.05, 0));
    const sd: [number, number, number] = sun ? sunDirection(sun) : [0.5, -0.5, 0.8];
    sunDirRef.current = sd;
    dirLight.position.set(cx + sd[0] * size, cy + sd[1] * size, minZ + Math.max(0.2, sd[2]) * size);
    scene.add(dirLight);

    // Aerial 3/4 default view — flat courses read as a course, not an edge.
    const baseZ = Math.max(minZ - size * 0.05, 0);
    camera.position.set(cx + size * 0.45, cy - size * 0.85, baseZ + size * 1.6);
    camera.up.set(0, 0, 1); // Z-up — the scene is Z-up (Z = altitude); using Y-up
    // would make terrain appear edge-on (sideways) during the loading hold.
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
    // Mobile touch: one finger rotates, two fingers zoom+pan. Prevent the
    // browser's own scroll/zoom so gestures stay in the 3D view.
    controls.touches = {
      ONE: THREE.TOUCH.ROTATE,
      TWO: THREE.TOUCH.DOLLY_PAN,
    };
    renderer.domElement.style.touchAction = 'none';

    // Pause auto-orbit while the user drags, resume after a short idle.
    const markInteract = () => { orbitAutoRef.current.lastInteract = performance.now(); };
    controls.addEventListener('start', markInteract);

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

    // Click-to-seek: in orbit mode, a single click on the ground finds the
    // nearest route point and jumps the playhead there.
    let downX = 0;
    let downY = 0;
    const onMouseDown = (e: MouseEvent) => {
      downX = e.clientX;
      downY = e.clientY;
    };
    const onMouseUp = (e: MouseEvent) => {
      // Only a clean click (no drag) — OrbitControls owns drags. Allowed in
      // orbit, including auto resolving to orbit this frame.
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 5) return;
      if (resolvedModeRef.current !== 'orbit') return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );
      raycaster.setFromCamera(pointer, camera);
      // Raycast against the terrain bed (or the road ribbon as fallback).
      const targets: THREE.Object3D[] = [];
      if (sceneRef.current?.terrain) targets.push(sceneRef.current.terrain);
      if (roadHitProxy) targets.push(roadHitProxy);
      if (targets.length === 0) return;
      const hits = raycaster.intersectObjects(targets, false);
      if (hits.length === 0) return;
      const pt = hits[0].point;
      // Find the nearest route point by XY distance.
      let bestIdx = 0;
      let bestDist = Infinity;
      for (let i = 0; i < points.length; i++) {
        const d = Math.hypot(points[i].x - pt.x, points[i].y - pt.y);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }
      // Only seek if the click was reasonably close to the route (< 500 m).
      if (bestDist < 500) {
        elapsedRef.current = points[bestIdx].elapsed;
        setDisplayElapsed(elapsedRef.current);
      }
    };
    renderer.domElement.addEventListener('mousedown', onMouseDown);
    renderer.domElement.addEventListener('mouseup', onMouseUp);

    // ── Path line (Line2: constant pixel width, vertex-coloured) ──────────
    // Lifted 2 cm above the road surface: the ribbon now sits exactly at
    // ground level, so the line overlays it instead of the road floating
    // beneath the line. Same relative geometry as before, anchored to truth.
    const pathPositions: number[] = [];
    points.forEach((p) => {
      pathPositions.push(p.x, p.y, p.z + 0.02);
    });
    const setLineResolution = (m: LineMaterial) => m.resolution.set(mount.clientWidth, mount.clientHeight);
    const pathGeo = new LineGeometry();
    pathGeo.setPositions(pathPositions);
    pathGeo.setColors(replayPathColorArray(points, colorByRef.current));
    const pathMat = new LineMaterial({ linewidth: 3, vertexColors: true, transparent: true, opacity: 0.9 });
    setLineResolution(pathMat);
    const pathLine = new Line2(pathGeo, pathMat);
    scene.add(pathLine);

    // ── "Race Yourself": coloured traces + animated markers for other rides ─
    // Filter once up front: setup and the tick loop index the same list, so a
    // short ride skipped here can't shift later markers onto the wrong ride.
    const raceRides = (race ?? []).filter((r) => r.points.length >= 2);
    const raceLines: { line: Line2; mat: LineMaterial }[] = [];
    const raceMarkers: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial }[] = [];
    if (raceRides.length > 0) {
      // max speed across all rides for the Phase 3 colour ramp
      let maxSpeed = 1;
      for (const ride of raceRides) for (const p of ride.points) if (p.speed > maxSpeed) maxSpeed = p.speed;
      for (const ride of raceRides) {
        const rg = new LineGeometry();
        const rp: number[] = [];
        const rc: number[] = [];
        for (const p of ride.points) {
          rp.push(p.x, p.y, p.z + 0.5);
          // Phase 3: colour by speed (green→amber→red), tinted toward the ride colour
          const [sr, sg, sb] = speedColor(p.speed, maxSpeed);
          const rideR = new THREE.Color(ride.color).r;
          const rideG = new THREE.Color(ride.color).g;
          const rideB = new THREE.Color(ride.color).b;
          rc.push(sr * 0.5 + rideR * 0.5, sg * 0.5 + rideG * 0.5, sb * 0.5 + rideB * 0.5);
        }
        rg.setPositions(rp);
        rg.setColors(rc);
        const rm = new LineMaterial({ linewidth: 2, vertexColors: true, transparent: true, opacity: 0.65 });
        setLineResolution(rm);
        const rl = new Line2(rg, rm);
        rl.visible = false; // shown only in orbit/overview
        scene.add(rl);
        raceLines.push({ line: rl, mat: rm });

        // Animated marker: a small cone at the ride's current position
        const mkGeo = new THREE.ConeGeometry(1.2, 3.5, 8);
        const mkMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(ride.color) });
        const mk = new THREE.Mesh(mkGeo, mkMat);
        mk.rotation.x = Math.PI / 2; // point along +Z (up in our frame)
        mk.visible = false;
        scene.add(mk);
        raceMarkers.push({ mesh: mk, mat: mkMat });
      }
    }

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
      width: 5,
      // The ribbon IS the ground surface (groundHeightAt == point z): zero
      // offset so the wheels touch it. The path line above carries the +0.02.
      zOffset: 0,
      dashPeriodM: 12,
      colors: roadTint(replayPathColorArray(points, colorByRef.current)),
    });
    let roadGeo: THREE.BufferGeometry | null = null;
    let roadMat: THREE.MeshPhongMaterial | null = null;
    let roadTex: THREE.Texture | null = null;
    if (roadData) {
      roadGeo = new THREE.BufferGeometry();
      roadGeo.setAttribute('position', new THREE.BufferAttribute(roadData.positions, 3));
      roadGeo.setAttribute('uv', new THREE.BufferAttribute(roadData.uvs, 2));
      roadGeo.setIndex(new THREE.BufferAttribute(roadData.indices, 1));
      // Smooth vertex normals so the ribbon shades with slope/aspect.
      // Without these the shader reads a zero normal (flat, wrong brightness)
      // and shadow reception breaks.
      roadGeo.computeVertexNormals();
      if (roadData.colors) roadGeo.setAttribute('color', new THREE.BufferAttribute(roadData.colors, 3));
      roadTex = createRoadTexture();
      // Phong (not Lambert): wet asphalt gets a sun/headlamp specular glint.
      // Shininess is driven per-frame by wetness; dry reads as matte.
      roadMat = new THREE.MeshPhongMaterial({
        map: roadTex,
        vertexColors: !!roadData.colors,
        side: THREE.DoubleSide,
        shininess: 8,
        specular: new THREE.Color(0x9db4d4),
      });
      const roadMesh = new THREE.Mesh(roadGeo, roadMat);
      roadMesh.receiveShadow = true;
      scene.add(roadMesh);
    }
    // Reusable hit proxy for click-to-seek (avoids creating a Mesh per click).
    const roadHitProxy = roadGeo ? new THREE.Mesh(roadGeo) : null;

    // ── Playhead beacon: a vertical light beam at the bike so the current
    // position is always findable from the overview zoom. Fades in orbit only.
    const beaconGeo = new THREE.CylinderGeometry(1.5, 1.5, 1, 8, 1, true);
    beaconGeo.rotateX(Math.PI / 2); // cylinder axis is +Y — lay it along +Z (scene is Z-up)
    const beaconMat = new THREE.MeshBasicMaterial({
      color: 0x22d3ee,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const beacon = new THREE.Mesh(beaconGeo, beaconMat);
    beacon.visible = false;
    scene.add(beacon);

    // ── Contact shadow under the bike (grounds it visually) ───────────────
    const shadowTex = createSoftShadowTexture();
    const shadowGeo = new THREE.CircleGeometry(0.6, 24);
    const shadowMat = new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      color: 0x000000,
    });
    const shadow = new THREE.Mesh(shadowGeo, shadowMat);
    shadow.renderOrder = 1;
    scene.add(shadow);

    // ── Bike rig: real-scale model, oriented + leaning (Phase 0) ──────────
    const rider = new THREE.Group();
    scene.add(rider);
    // Headlamp: practical light for night/blue rides. A rider child so it
    // follows the bike for free; intensity is darkness-driven (see setup +
    // time scrubber). Tuned by eye against the night baseline.
    const headlamp = new THREE.PointLight(0xffd9a0, L.headlamp * HEADLAMP_MAX, 55, 2);
    headlamp.position.set(0, 0, 2.2);
    rider.add(headlamp);
    const riderDir = new THREE.Vector3(1, 0, 0);
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
        rig.object.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          // Skip transparent meshes: the wheel motion-blur discs would
          // otherwise cast solid disc shadows on the road.
          const mats = Array.isArray(m.material) ? m.material : [m.material];
          if (mats.some((mm) => (mm as THREE.Material).transparent)) return;
          m.castShadow = true;
        });
        bikeRig = rig;
        if (sceneRef.current) sceneRef.current.bike = rig;
      })
      .catch(() => {
        /* model failed to load — the path line still tells the story */
      });

    // ── Ghost bike (Phase 5): translucent, time-aligned with the rider ────
    const ghostPoints = ghost?.build.points ?? null;
    const ghostRider = new THREE.Group();
    ghostRider.visible = false;
    scene.add(ghostRider);
    const ghostDir = new THREE.Vector3(1, 0, 0);
    let ghostRig: BikeRig | null = null;
    if (ghostPoints) {
      createBikeRig({ ghost: true })
        .then((rig) => {
          if (bikeCancelled) {
            rig.dispose();
            return;
          }
          ghostRider.add(rig.object);
          ghostRig = rig;
        })
        .catch(() => {
          /* ghost model optional */
        });
    }

    // ── Wet-road mirror: a dimmed bike clone under the contact patch ───────
    // A true planar reflection needs a mirror render target; instead the
    // mirrored rig draws faintly OVER the opaque ribbon (depth test off, late
    // render order), which reads as a wet mirror at a fraction of the cost.
    // The group origin is the contact patch, so mirroring Z about it plants
    // the reflection exactly under the bike.
    const reflGroup = new THREE.Group();
    reflGroup.scale.z = -1;
    reflGroup.visible = false;
    scene.add(reflGroup);
    let reflRig: BikeRig | null = null;
    createBikeRig({ reflection: true })
      .then((rig) => {
        if (bikeCancelled) {
          rig.dispose();
          return;
        }
        rig.object.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          const mats = Array.isArray(m.material) ? m.material : [m.material];
          for (const mm of mats) {
            const mat = mm as THREE.Material;
            mat.depthTest = false;
            // Mirroring flips face winding — without this the clone culls
            // itself into near-invisibility.
            mat.side = THREE.DoubleSide;
          }
          m.renderOrder = 5;
          m.castShadow = false;
        });
        reflGroup.add(rig.object);
        reflRig = rig;
      })
      .catch(() => {
        /* mirror optional — the sheen still sells wetness */
      });

    // ── Start/finish markers: green cone at start, white sphere at end ────
    const markerGroup = new THREE.Group();
    scene.add(markerGroup);
    const markerDisposables: { dispose: () => void }[] = [];
    {
      const first = points[0];
      const last = points[points.length - 1];
      const startGeo = new THREE.ConeGeometry(1, 2.5, 8);
      const startMat = new THREE.MeshBasicMaterial({ color: 0x22c55e });
      const startMk = new THREE.Mesh(startGeo, startMat);
      startMk.rotation.x = Math.PI / 2; // cone tip is +Y — point it along +Z like the race markers
      startMk.position.set(first.x, first.y, groundHeightAt(points, first.x, first.y) + 1.2);
      markerGroup.add(startMk);
      markerDisposables.push(startGeo, startMat);

      const endGeo = new THREE.SphereGeometry(1, 12, 12);
      const endMat = new THREE.MeshBasicMaterial({ color: 0xf1f5f9 });
      const endMk = new THREE.Mesh(endGeo, endMat);
      endMk.position.set(last.x, last.y, groundHeightAt(points, last.x, last.y) + 1.2);
      markerGroup.add(endMk);
      markerDisposables.push(endGeo, endMat);
    }

    // ── Km markers: dot + distance label at regular intervals ──────────────
    // Out-and-back courses revisit the same ground — skip markers that land
    // on top of an earlier one and stagger label heights so pairs separate.
    {
      const totalKm = build.totalDistance / 1000;
      const intervalKm = totalKm > 150 ? 25 : totalKm > 60 ? 10 : 5;
      const dotGeo = new THREE.SphereGeometry(1, 10, 10);
      const dotMat = new THREE.MeshBasicMaterial({ color: 0x94a3b8 });
      markerDisposables.push(dotGeo, dotMat);
      const placed: THREE.Vector3[] = [];
      let stagger = 0;
      for (let k = intervalKm; k < totalKm; k += intervalKm) {
        const target = k * 1000;
        const idx = points.findIndex((pt) => pt.distance >= target);
        if (idx < 0) continue;
        const mp = points[idx];
        const pos = new THREE.Vector3(mp.x, mp.y, groundHeightAt(points, mp.x, mp.y));
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
        // Screen-constant (sizeAttenuation false) so the label stays legible
        // from both the chase cam and the aerial overview.
        const spriteMat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, sizeAttenuation: false });
        const sprite = new THREE.Sprite(spriteMat);
        sprite.scale.set(0.085, 0.021, 1);
        stagger = stagger === 0 ? 1 : 0;
        sprite.position.set(pos.x, pos.y, pos.z + 4 + stagger * 3);
        markerGroup.add(sprite);
        markerDisposables.push(tex, spriteMat);
      }
    }

    // ── Segment zones: climb sections as coloured bands on the road ────────
    // A thicker, semi-transparent ribbon over the road where the highlight
    // occurs, so climbs/descents read at a glance from the overview.
    const zoneMeshes: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial }[] = [];
    {
      for (const h of detectHighlights(points)) {
        if (h.kind !== 'climb' && h.kind !== 'descent') continue;
        const startIdx = nearestIndex(points, h.startElapsed);
        const endIdx = nearestIndex(points, h.endElapsed);
        if (endIdx - startIdx < 2) continue;
        const zonePts = points.slice(startIdx, endIdx + 1);
        const zoneData = buildRoadRibbon(zonePts, { width: 9, zOffset: 0.15 });
        if (!zoneData) continue;
        const zg = new THREE.BufferGeometry();
        zg.setAttribute('position', new THREE.BufferAttribute(zoneData.positions, 3));
        zg.setIndex(new THREE.BufferAttribute(zoneData.indices, 1));
        const zc = new THREE.Color(h.kind === 'climb' ? '#f97316' : '#38bdf8');
        const zm = new THREE.MeshBasicMaterial({
          color: zc.getHex(),
          transparent: true,
          opacity: 0.25,
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        const zm_mesh = new THREE.Mesh(zg, zm);
        zm_mesh.visible = false; // overview only
        scene.add(zm_mesh);
        zoneMeshes.push({ mesh: zm_mesh, mat: zm });
      }
    }

    // ── Highlight markers: climbs / descents / sprint / fastest on the road ─
    const HIGHLIGHT_COLOR: Record<HighlightKind, string> = {
      climb: '#f97316',
      descent: '#38bdf8',
      sprint: '#facc15',
      fastest: '#22c55e',
    };
    {
      for (const h of detectHighlights(points)) {
        const mp = points[nearestIndex(points, h.startElapsed)];
        const dotGeo = new THREE.SphereGeometry(1, 10, 10);
        const dotMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(HIGHLIGHT_COLOR[h.kind]) });
        const dot = new THREE.Mesh(dotGeo, dotMat);
        dot.position.set(mp.x, mp.y, mp.z + 1);
        markerGroup.add(dot); // mesh children are distance-scaled each frame
        markerDisposables.push(dotGeo, dotMat);

        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 96;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.font = 'bold 44px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          const label = h.label;
          const w = Math.min(496, ctx.measureText(label).width + 40);
          const x0 = (512 - w) / 2;
          ctx.fillStyle = HIGHLIGHT_COLOR[h.kind];
          if (typeof ctx.roundRect === 'function') {
            ctx.beginPath();
            ctx.roundRect(x0, 12, w, 72, 14);
            ctx.fill();
          } else {
            ctx.fillRect(x0, 12, w, 72);
          }
          ctx.fillStyle = '#0b1220';
          ctx.fillText(label, 256, 50);
        }
        const tex = new THREE.CanvasTexture(canvas);
        const spriteMat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, sizeAttenuation: false });
        const sprite = new THREE.Sprite(spriteMat);
        sprite.scale.set(0.16, 0.03, 1);
        sprite.position.set(mp.x, mp.y, mp.z + 6);
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
    // Adaptive budget: judged once the scene is fully loaded, applied once.
    const perfBudget = createPerfBudget();
    const tmpDesired = new THREE.Vector3();
    const tmpLook = new THREE.Vector3();
    const _tmpAxis = new THREE.Vector3();
    const poseAt = (pts: ReplayPoint[], time: number, pos: THREE.Vector3, dir: THREE.Vector3) => {
      const i = nearestIndex(pts, time);
      const p0 = pts[i];
      const p1 = pts[Math.min(pts.length - 1, i + 1)];
      const spanE = p1.elapsed - p0.elapsed || 1;
      const f = p1 === p0 ? 0 : Math.max(0, Math.min(1, (time - p0.elapsed) / spanE));
      pos.set(p0.x + (p1.x - p0.x) * f, p0.y + (p1.y - p0.y) * f, p0.z + (p1.z - p0.z) * f);
      const a = pts[Math.max(0, i - 4)];
      const b = pts[Math.min(pts.length - 1, i + 6)];
      // Only replace the heading when the window is non-degenerate — a zeroed
      // forward vector would collapse the chase camera onto the bike.
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dz = b.z - a.z;
      if (dx * dx + dy * dy + dz * dz > 1e-9) dir.set(dx, dy, dz).normalize();
      return { index: i, speed: p0.speed };
    };
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (!sceneReady) setSceneReady(true);
      // Adaptive performance: count only settled frames (loading jank must
      // never count), judge once, step down once. Lite mode is already
      // minimal — nothing left to shed there.
      if (!liteMode && !perfReducedRef.current) {
        const settled = terrainStateRef.current !== 'loading' && imageryStateRef.current !== 'loading';
        if (settled) {
          const fps = perfObserve(perfBudget, dt * 1000);
          if (fps != null && perfNeedsDegrade(fps)) {
            perfReducedRef.current = true;
            const w = mount.clientWidth;
            const h = mount.clientHeight;
            renderer.setPixelRatio(1);
            if (composer && w > 0 && h > 0) {
              composer.setPixelRatio(1);
              composer.setSize(w, h);
              const dofState = sceneRef.current?.dof;
              if (dofState) syncDofTarget(dofState, w, h, 1);
              const bloom = composer.passes.find((p) => p instanceof UnrealBloomPass);
              if (bloom) bloom.enabled = false;
            }
            // Honest UI flips — the toggles show the reduced state and the
            // user can re-enable either (nothing re-degrades behind them).
            setRaysOn(false);
            setDofOn(false);
            if (weatherFx) weatherFx.visible = false;
            setPerfMode('reduced');
            setPerfFps(Math.round(fps));
          }
        }
      }
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
      const riderPose = poseAt(points, t, rider.position, riderDir);
      if (bikeRig) {
        bikeRig.setPose(riderDir, leanAt(points, riderPose.index), dt);
        bikeRig.update(riderPose.speed, rideDelta);
      }
      // Wet-road mirror tracks the bike's pose; visible only when wet (never
      // in the cockpit, where the rig itself is hidden).
      if (reflRig) {
        const mirrorOn = wetnessRef.current > 0.04 && rider.visible;
        reflGroup.visible = mirrorOn;
        if (mirrorOn) {
          reflGroup.position.copy(rider.position);
          reflRig.setPose(riderDir, leanAt(points, riderPose.index), dt);
          reflRig.update(riderPose.speed, rideDelta);
        }
      }
      // ── Auto-camera: resolve 'auto' BEFORE anything else reads the mode ──
      // Decision table lives in lib/director (pure + tested); the component
      // supplies context. Hysteresis via a cooldown so we don't flip frames.
      // Road window, markers, fog, FOV and the HUD badge all use `mode`.
      const pickAutoCamera = () => {
        const idx = nearestIndex(points, t);
        const p = points[idx];
        // Highlight proximity: within 10s of a highlight start → drone to frame it.
        const ah = activeHighlightRef.current;
        return pickAutoCameraMode({
          grade: p.grade ?? 0,
          speed: riderPose.speed,
          power: p.power,
          ftpWatts,
          nearHighlight: !!ah && Math.abs(t - ah.startElapsed) < 10,
        });
      };
      let mode = camModeRef.current;
      if (mode === 'auto') {
        const auto = autoCamRef.current;
        if (now >= auto.until) {
          const next = pickAutoCamera();
          // Reduced motion swaps the circling flyby for a held orbit — the
          // calm default these users asked the OS for.
          const resolved = reducedMotionRef.current && next === 'flyby' ? 'orbit' : next;
          // Cooldown: 6s for orbit (stable), 4s for action cams.
          auto.mode = resolved;
          auto.until = now + (resolved === 'orbit' ? 6000 : 4000);
        }
        mode = auto.mode;
      }
      if (mode !== resolvedModeRef.current) {
        resolvedModeRef.current = mode;
        // 'auto' is unwrapped by now; scripted modes have no HUD badge entry.
        if (mode !== 'cinematic' && mode !== 'shot') setResolvedAuto(mode);
      }
      // Segments drawn = point index (points 0..i need i segments).
      trailGeo.instanceCount = Math.max(0, Math.min(riderPose.index, points.length - 1));
      // Overview modes (orbit/cinematic): render the entire road so the full
      // course is visible. Chase/cockpit: window around the rider — the distant
      // leg projects into a band from a low camera, and the span is generous
      // enough to read as continuous ahead and behind.
      const shotWide = mode === 'shot' && shotKindRef.current !== null && shotWantsOverview(shotKindRef.current);
      const inOverview = mode === 'orbit' || mode === 'cinematic' || mode === 'drone' || mode === 'flyby' || shotWide;
      if (roadGeo) {
        if (inOverview) {
          roadGeo.setDrawRange(0, roadGeo.getIndex()!.count);
        } else {
          const W = 220;
          const segStart = Math.max(0, riderPose.index - W);
          const segEnd = Math.min(points.length - 2, riderPose.index + W);
          roadGeo.setDrawRange(segStart * 6, Math.max(0, (segEnd - segStart + 1) * 6));
        }
      }
      // Full-route centerline: visible whenever the camera is high enough to
      // read the whole course (not chase/cockpit, where it's visual noise).
      pathLine.visible = inOverview;
      for (const z of zoneMeshes) z.mesh.visible = inOverview;
      for (const rl of raceLines) rl.line.visible = inOverview;
      // Race markers: orbit only (not during the cinematic intro — visual noise).
      const raceVisible = mode === 'orbit';
      if (raceVisible) {
        for (let ri = 0; ri < raceRides.length && ri < raceMarkers.length; ri++) {
          const ride = raceRides[ri];
          const mk = raceMarkers[ri];
          const idx = raceIndexAt(ride.points, t);
          const p = ride.points[idx];
          // Race on the main-ride surface, not the ghost's barometric z —
          // different-day altimeters disagree by metres, the DEM drape doesn't.
          mk.mesh.position.set(p.x, p.y, groundHeightAt(points, p.x, p.y) + 1.8);
          mk.mesh.visible = true;
          // scale marker by camera distance for constant apparent size
          const d = camera.position.distanceTo(mk.mesh.position);
          mk.mesh.scale.setScalar(Math.max(0.5, d * 0.006));
        }
      } else {
        for (const mk of raceMarkers) mk.mesh.visible = false;
      }
      // Contact shadow follows the bike on the ground surface.
      shadow.position.set(
        rider.position.x,
        rider.position.y,
        groundHeightAt(points, rider.position.x, rider.position.y) + 0.01
      );
      shadow.rotation.z = Math.atan2(riderDir.y, riderDir.x);
      shadow.visible = mode !== 'cockpit';
      // Playhead beacon: a vertical beam at the bike, visible from the overview.
      // Scale by camera distance so it reads at any zoom (taller when far away).
      {
        const camDist = camera.position.distanceTo(rider.position);
        const beamH = Math.max(8, camDist * 0.06);
        const beamR = Math.max(0.8, camDist * 0.004);
        beacon.position.set(rider.position.x, rider.position.y, rider.position.z + beamH / 2);
        beacon.scale.set(beamR, beamR, beamH);
        beacon.visible = mode === 'orbit' || mode === 'cinematic';
      }
      // Km-marker dots: keep a constant apparent size — at real scale the 0 km
      // dot would otherwise engulf the close camera.
      for (const child of markerGroup.children) {
        const dist = camera.position.distanceTo(child.position);
        if ((child as THREE.Mesh).isMesh) {
          child.scale.setScalar(Math.max(0.15, dist * 0.012));
        } else if ((child as THREE.Sprite).isSprite) {
          // Screen-constant labels would clutter the horizon — fade them out.
          (child as THREE.Sprite).material.opacity = Math.max(0, Math.min(1, 1 - (dist - 600) / 900));
        }
      }
      // Keep the shadow frustum centred on the bike.
      if (dirLight.castShadow) {
        dirLight.position.set(
          rider.position.x + sd[0] * 30,
          rider.position.y + sd[1] * 30,
          rider.position.z + Math.max(2, sd[2]) * 30
        );
        dirLight.target.position.copy(rider.position);
        dirLight.target.updateMatrixWorld();
      }
      // ── Weather particle animation (camera-relative) ─────────────────────
      if (weatherFx) {
        weatherFx.position.copy(camera.position);
        const arr = (weatherFx.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array;
        const isStreaks = weatherFx instanceof THREE.LineSegments;
        const fall = Math.min(0.1, dt) * (weatherType === 'rain' ? 34 : weatherType === 'snow' ? 4 : 2);
        // Wind drift pushes particles horizontally as they fall.
        const wx = windVec.x * Math.min(0.1, dt);
        if (isStreaks) {
          for (let i = 0; i < arr.length; i += 6) {
            arr[i + 2] -= fall; arr[i + 5] -= fall;
            arr[i] += wx; arr[i + 3] += wx;
            if (arr[i + 5] < -25) { arr[i + 2] += 55; arr[i + 5] += 55; arr[i] = (Math.random() - 0.5) * 80; arr[i + 3] = arr[i] + 0.6; }
          }
        } else {
          const drift = weatherType === 'snow' ? Math.sin(now / 700 + 0) * 0.3 : 0; // gentle sway
          for (let i = 0; i < arr.length; i += 3) {
            arr[i + 2] -= fall;
            arr[i] += wx + drift; arr[i + 1] += Math.cos(now / 900 + i) * 0.02;
            if (arr[i + 2] < -30) { arr[i + 2] += 60; arr[i] = (Math.random() - 0.5) * 90; arr[i + 1] = (Math.random() - 0.5) * 90; }
          }
        }
        (weatherFx.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      }

      // ── Speed streaks: spawn motion trails behind the bike ────────────────
      const curSpeed = riderPose.speed;
      streakHistory.push({ x: rider.position.x, y: rider.position.y, z: rider.position.z, speed: curSpeed });
      if (streakHistory.length > 60) streakHistory.shift();
      const streakIntensity = Math.min(1, curSpeed / 14); // fades in above ~14 m/s
      // Motion trails only make sense in motion: a static rider stacks all
      // points at one spot and the additive pile-up saturates to a whiteout
      // (plus bloom smear). Gate on the clock actually advancing.
      if (streakIntensity > 0.05 && rideDelta > 0) {
        // Sample positions along the recent path; place streak points between them.
        const segs = Math.min(STREAK_COUNT, Math.floor(streakIntensity * STREAK_COUNT));
        const histLen = streakHistory.length;
        let si = 0;
        for (let i = 0; i < segs; i++) {
          const t = i / segs;
          const idx = Math.floor(t * (histLen - 1));
          const next = Math.min(histLen - 1, idx + 1);
          const f = t * (histLen - 1) - idx;
          const a = streakHistory[idx], b = streakHistory[next];
          streakPos[si * 3] = a.x + (b.x - a.x) * f;
          streakPos[si * 3 + 1] = a.y + (b.y - a.y) * f;
          streakPos[si * 3 + 2] = a.z + (b.z - a.z) * f;
          const fade = (1 - t) * streakIntensity;
          streakCol[si * 3] = fade;
          streakCol[si * 3 + 1] = fade;
          streakCol[si * 3 + 2] = fade;
          si++;
        }
        // Zero out unused points (push them far away + black them out).
        for (let i = si; i < STREAK_COUNT; i++) {
          streakPos[i * 3 + 2] = -9999;
          streakCol[i * 3] = streakCol[i * 3 + 1] = streakCol[i * 3 + 2] = 0;
        }
        // Color shifts from cyan (cool) to orange (hot) with effort.
        const effort = ftpWatts ? Math.min(1, (points[nearestIndex(points, t)].power ?? 0) / (ftpWatts * 1.5)) : curSpeed / 14;
        streakMat.color.setHSL(0.55 - effort * 0.45, 0.9, 0.55);
        streakMat.opacity = 0.25 + streakIntensity * 0.5;
        (streakGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
        (streakGeo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
        // A reduced profile keeps streaks off (set once at degrade time);
        // reduced motion keeps them off too (speed lines are motion effects).
        streaks.visible = !perfReducedRef.current && !reducedMotionRef.current;
      } else {
        streaks.visible = false;
      }
      // Wet road: darken + desaturate the asphalt, lift a faint blue sheen,
      // and open the specular gate so sun/headlamp glint off standing water.
      // Dry → matte, no change.
      const roadMat = sceneRef.current?.roadMat;
      if (roadMat) {
        const w = wetnessRef.current;
        const base = 1 - w * 0.45; // darker when wet
        roadMat.color.setRGB(base, base, base + w * 0.04); // faint blue sheen
        roadMat.shininess = 6 + w * 70;
      }
      // Tight fog in follow cams so the windowed road fades out instead of
      // ending in a hard edge; wide in orbit so the whole route stays visible.
      if (scene.fog) {
        const fog = scene.fog as THREE.Fog;
        const follow = mode !== 'orbit' && mode !== 'cinematic' && !shotWide;
        fog.near = follow ? 60 : size * 0.4;
        fog.far = follow ? 1400 * fogFarScale : size * 3.2 * fogFarScale;
      }

      if (ghostPoints) {
        const gt = Math.min(t, ghostPoints[ghostPoints.length - 1].elapsed);
        const gp = poseAt(ghostPoints, gt, ghostRider.position, ghostDir);
        // Plant the ghost on the main-ride surface: its own barometric z
        // comes from a different day and would float/sink against the drape.
        ghostRider.position.z = groundHeightAt(points, ghostRider.position.x, ghostRider.position.y);
        ghostRider.visible = mode !== 'cockpit';
        if (ghostRig) {
          ghostRig.setPose(ghostDir, leanAt(ghostPoints, gp.index), dt);
          ghostRig.update(gp.speed, rideDelta);
        }
      }

      if (mode === 'orbit') {
        camera.up.copy(UP_Z);
        controls.enabled = true;
        rider.visible = true;

        // The scene is "camera-ready" once terrain has loaded (or is off/failed).
        // Before that, hold the home pose — moving the camera over an empty or
        // half-built scene looks broken and seeds a bogus orbit angle.
        const terrainMesh = sceneRef.current?.terrain;
        const terrainState = terrainStateRef.current;
        // Hold for the satellite drape too — orbiting over an undraped bed
        // while the overlay counts tiles looks broken.
        const ready = (terrainMesh || terrainState === 'off' || terrainState === 'failed') && imageryStateRef.current !== 'loading';

        if (!ready) {
          // Terrain still loading — hold a static overview with proper Z-up
          // orientation. auto-orbit kicks in once terrain arrives.
          camera.position.copy(homePos);
          camera.up.copy(UP_Z);
          controls.target.copy(homeTarget);
          controls.update();
        } else {
          // ── Cinematic auto-orbit: a virtual drone circles the rider ─────────
          // Orbit angle + radius adapt to ride speed, the camera looks slightly
          // ahead into the direction of travel, and it eases back in after the
          // user manually drags OrbitControls.
          const auto = orbitAutoRef.current;

        const idleFor = now - auto.lastInteract;
        const RESUME_DELAY = 2500; // ms of idle before auto-orbit resumes
        const RESUME_BLEND = 1500; // ms to ease from manual pose to auto
        // Cinematic just handed off to orbit — skip the resume delay so the
        // camera keeps moving instead of freezing for 2.5s after the intro.
        const handoffBoost = orbitJustHandedOffRef.current;
        if (handoffBoost) orbitJustHandedOffRef.current = false;

        if (idleFor < RESUME_DELAY && !handoffBoost) {
          // User recently drove the camera — let OrbitControls own the pose.
          // Forget the shot so resume re-seeds from the live pose (no snap).
          controls.update();
          auto.shot = null;
        } else if (auto.shot || riderPose.index >= 0) {
          // Seed the shot from the current camera direction on the first ready
          // tick (rider.position is only valid after poseAt ran).
          if (!auto.shot) {
            const dx = camera.position.x - rider.position.x;
            const dy = camera.position.y - rider.position.y;
            if (dx * dx + dy * dy > 1) auto.shot = seedOrbitShot(now, Math.atan2(dy, dx));
          }
          if (!auto.shot) {
            controls.update();
          } else {
          // Hold the composed shot; ease to a reframed angle when the hold
          // expires — a virtual drone that reframes instead of spinning.
          // Reduced motion freezes the hold: same cinematic framing, no drift.
          const orbitAngle = reducedMotionRef.current ? auto.shot.angle : updateOrbitShot(auto.shot, now);
          // Radius widens with speed (intimate when slow, sweeping when fast).
          const radius = 26 + Math.min(42, riderPose.speed * 1.3);

          // Height: 3/4 view that rises with speed, plus a gentle vertical bob.
          const bob = reducedMotionRef.current ? 0 : Math.sin(t * 0.55) * 2.5;
          const height = 12 + Math.min(18, riderPose.speed * 0.45) + bob;

          // ── Aspect-adaptive elliptical orbit ──────────────────────────────
          // A circular orbit wastes frame space on a long thin route. Use the
          // route's principal-direction PCA to stretch the ellipse along the
          // route's long axis, clamped so near-symmetric rides stay circular.
          const extent = routeExtentRef.current;
          let offX = radius, offY = radius; // default circular offset
          if (extent) {
            const ratio = Math.min(2.5, Math.max(0.4, extent.rx / (extent.ry || 1)));
            const theta = Math.atan2(extent.dirY, extent.dirX);
            // Ellipse in local frame, rotated to align long axis with route.
            const lx = radius * ratio * Math.cos(orbitAngle);
            const ly = radius * Math.sin(orbitAngle);
            offX = lx * Math.cos(theta) - ly * Math.sin(theta);
            offY = lx * Math.sin(theta) + ly * Math.cos(theta);
          }
          const desired = tmpDesired.set(
            rider.position.x + offX,
            rider.position.y + offY,
            rider.position.z + height,
          );

          // Look ahead of the rider into their direction of travel.
          const lookAhead = 6 + riderPose.speed * 0.35;
          const lx = rider.position.x + riderDir.x * lookAhead;
          const ly = rider.position.y + riderDir.y * lookAhead;
          const lz = rider.position.z + 1.2;

          // Ease from the manual resume point to the auto pose (no snap).
          const blend = Math.min(1, (idleFor - RESUME_DELAY) / RESUME_BLEND);
          const k = 0.02 + blend * 0.1; // stronger pull once fully resumed
          camera.position.lerp(desired, k);

          // Subtle speed-adaptive FOV — widens slightly at speed for motion feel.
          if (!reducedMotionRef.current) {
            const targetFov = 46 + Math.min(16, riderPose.speed * 0.28);
            camera.fov += (targetFov - camera.fov) * 0.04;
            camera.updateProjectionMatrix();
          }

          controls.target.set(lx, ly, lz);
          camera.lookAt(lx, ly, lz);

          // ── Camera banking: roll into turns for a drone-like feel ────────
          // Yaw rate from heading change → bank angle. Cross product sign gives
          // the turn direction (left/right). Smoothed so it doesn't jitter.
          // Skipped for reduced motion (the horizon stays level).
          if (!reducedMotionRef.current && prevHeadingRef.current && riderDir.lengthSq() > 1e-9) {
            const prev = prevHeadingRef.current;
            // Horizontal-plane cross product (z component) → turn direction.
            const turn = prev.x * riderDir.y - prev.y * riderDir.x;
            const targetBank = Math.max(-0.35, Math.min(0.35, -turn * 8));
            auto.bankAngle += (targetBank - auto.bankAngle) * Math.min(1, dt * 4);
            // Roll camera.up around the look axis by the bank angle.
            _tmpAxis.set(lx - camera.position.x, ly - camera.position.y, lz - camera.position.z).normalize();
            camera.up.copy(UP_Z);
            camera.up.applyAxisAngle(_tmpAxis, auto.bankAngle);
          }
          prevHeadingRef.current = prevHeadingRef.current?.copy(riderDir) ?? riderDir.clone();

          // No controls.update() — it recomputes camera position from its
          // internal spherical state and would override our pose. OrbitControls
          // picks up the live camera position on the next user 'start' event.
          }
        }
        } // end if (!ready) else
      } else if (mode === 'cinematic' && directorPath.duration > 0) {
        // Cinematic director: wait for the terrain bed + imagery to settle,
        // then play a scripted flyover and hand off to chase.
        controls.enabled = false;
        // Gate on the terrain bed AND the satellite drape being settled —
        // starting the flight while tiles pop in looks broken (this can hold
        // the intro on slow connections, which is the requested behavior).
        const terrainReady = !!sceneRef.current?.terrain && imageryStateRef.current !== 'loading';
        if (cinematicStart < 0 && terrainReady) {
          cinematicStart = performance.now();
        }
        if (cinematicStart < 0) {
          // Not ready yet — hold a static overview shot with Z-up orientation.
          camera.up.copy(UP_Z);
          camera.position.copy(homePos);
          camera.fov = 55;
          camera.updateProjectionMatrix();
          camera.lookAt(homeTarget);
          rider.visible = true;
        } else {
          const cinematicTime = (now - cinematicStart) / 1000;
          const sample = samplePath(directorPath, cinematicTime);
          camera.up.copy(UP_Z);
          camera.fov = sample.fov;
          camera.updateProjectionMatrix();
          camera.position.set(sample.position[0], sample.position[1], sample.position[2]);
          tmpLook.set(sample.target[0], sample.target[1], sample.target[2]);
          camera.lookAt(tmpLook);
          rider.visible = true;
          if (cinematicTime >= directorPath.duration + CINEMATIC_HOLD) {
            // Hand off to orbit; revert auto-enabled imagery (too low-res for
            // close-up) — a manual user choice always wins over the revert.
            if (cinematicImageryRef.current && !userImageryToggledRef.current) {
              setImageryState('off');
            }
            cinematicImageryRef.current = false;
            orbitJustHandedOffRef.current = true; // skip resume delay on handoff
            setCamMode('orbit');
          }
        }
      } else if (mode === 'shot' && shotPathRef.current) {
        // Tour-only scripted shot: play the library path, then hand back to
        // whatever mode was active before the beat started.
        controls.enabled = false;
        const shotPath = shotPathRef.current;
        const shotT = (now - shotStartRef.current) / 1000;
        const sample = samplePath(shotPath, shotT);
        camera.up.copy(UP_Z);
        camera.fov = sample.fov;
        camera.updateProjectionMatrix();
        camera.position.set(sample.position[0], sample.position[1], sample.position[2]);
        tmpLook.set(sample.target[0], sample.target[1], sample.target[2]);
        camera.lookAt(tmpLook);
        rider.visible = true;
        if (shotT >= shotPath.duration) {
          shotPathRef.current = null;
          shotKindRef.current = null;
          setCamMode(preShotModeRef.current);
        }
      } else {
        // Follow cams drive the camera directly; OrbitControls stays out.
        // Reset the up vector every frame — the orbit drone rolls camera.up
        // into turns, and without this the bank leaks into follow cams.
        camera.up.copy(UP_Z);
        // Cockpit sits inside the bike: hide the rig or it fills the frame.
        rider.visible = mode !== 'cockpit';
        // Hold the home pose until terrain is ready — following the rider over
        // an empty grid makes the camera snap to (0,0,0) and spin sideways.
        const terrainMesh = sceneRef.current?.terrain;
        const terrainState = terrainStateRef.current;
        // Same both-terrain-and-imagery gate as orbit: no following the rider
        // over an undraped bed while tiles are still loading.
        const ready = (terrainMesh || terrainState === 'off' || terrainState === 'failed') && imageryStateRef.current !== 'loading';
        if (!ready) {
          camera.position.copy(homePos);
          controls.target.copy(homeTarget);
          controls.update();
        } else {
        if (mode === 'chase') {
          // Close chase: ~7 m behind, ~2.6 m up, eyes on the road ahead.
          const dist = 7;
          const height = 2.6;
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
        } else if (mode === 'flyby') {
          // Cinematic fly-by: a slow orbit around the rider (no camera lag).
          const ang = (now / 1000) * 0.35;
          const radius = 13;
          const height = 4.5 + Math.sin(now / 4500) * 1.5;
          tmpDesired.set(
            rider.position.x + Math.cos(ang) * radius,
            rider.position.y + Math.sin(ang) * radius,
            rider.position.z + height
          );
          tmpLook.set(rider.position.x, rider.position.y, rider.position.z + 1.3);
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
        if (mode === 'flyby') {
          camera.position.copy(tmpDesired);
        } else {
          if (!followPosRef.current) followPosRef.current = tmpDesired.clone();
          // Smooth chase: exponential lerp with a distance-adaptive rate so the
          // camera catches up fast when it's behind (high playback rates) but
          // glides when it's close. Snap only on extreme jumps (> 25 m).
          const lag = followPosRef.current.distanceTo(tmpDesired);
          const baseRate = 10; // fast enough to track at 24× playback
          const boost = Math.min(4, lag / 5); // up to 4× faster when > 20 m behind
          const rate = baseRate + boost;
          const k = lag > 25 ? 1 : 1 - Math.exp(-dt * rate);
          followPosRef.current.lerp(tmpDesired, k);
          camera.position.copy(followPosRef.current);
        }
        // Smooth the look target too — a hard lookAt on every frame makes the
        // view jitter when the heading changes. Lerp toward the desired target.
        if (!lookTargetRef.current) lookTargetRef.current = tmpLook.clone();
        const lookLag = lookTargetRef.current.distanceTo(tmpLook);
        const lookK = lookLag > 20 ? 1 : 1 - Math.exp(-dt * 8);
        lookTargetRef.current.lerp(tmpLook, lookK);
        camera.lookAt(lookTargetRef.current);
        }
      }
      // Keep the camera above the terrain bed so follow cams can't clip through
      // hills (the DEM y is only known here via the mesh's stored grid).
      const terrainMesh = sceneRef.current?.terrain;
      if (mode !== 'orbit' && terrainMesh?.userData.heights) {
        const g = terrainMesh.userData.grid as RouteGrid;
        const tAltMin = terrainMesh.userData.altMin as number;
        const tZ = terrainMesh.userData.zScale as number;
        const mPerDegLng = 111320 * Math.cos((build.lat0 * Math.PI) / 180);
        const lat = build.lat0 + camera.position.y / 111320;
        const lng = build.lng0 + camera.position.x / mPerDegLng;
        const h = bilinearHeight(g, terrainMesh.userData.heights as number[], lat, lng);
        if (h != null) {
          const minCamZ = (h - tAltMin) * tZ + 1.6;
          if (camera.position.z < minCamZ) {
            camera.position.z = minCamZ;
            if (followPosRef.current) followPosRef.current.z = minCamZ;
            // Only re-look in follow cams; the cinematic director owns its lookAt.
            if (lookTargetRef.current && mode !== 'cinematic') {
              camera.lookAt(lookTargetRef.current);
            }
          }
        }
      }
      // Speed feel: widen the FOV slightly with speed (follow cams only —
      // the cinematic director and auto-orbit own their own FOV).
      const fovOwnedByCam = mode === 'cinematic' || mode === 'orbit' || mode === 'shot';
      if (!fovOwnedByCam) {
        const targetFov = 55 + Math.min(1, riderPose.speed / 12) * 9;
        if (Math.abs(camera.fov - targetFov) > 0.05) {
          camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 3);
          camera.updateProjectionMatrix();
        }
      }
      sky.position.copy(camera.position);
      if (sceneRef.current?.cloud) {
        sceneRef.current.cloud.position.copy(camera.position);
        // Frozen drift under reduced motion — the layer stays put.
        if (!reducedMotionRef.current) tickCloudDome(sceneRef.current.cloud, now / 1000);
      }
      // Ride audio at ~7 Hz — the engine smooths internally, so per-frame
      // updates would only churn. Silent when paused.
      audioAccRef.current += dt;
      if (audioRef.current && audioAccRef.current > 0.15) {
        audioAccRef.current = 0;
        if (playingRef.current) {
          audioRef.current.setWind(riderPose.speed);
          audioRef.current.setHeart(points[riderPose.index]?.hr ?? null);
        } else {
          audioRef.current.setWind(0);
          audioRef.current.setHeart(null);
        }
      }
      // God-rays track the sun's screen position; off-screen/behind fades to 0.
      const raysPass = sceneRef.current?.rays;
      if (raysPass) {
        const screen = sunScreenPosition(camera, sunDirRef.current);
        const ru = raysPass.uniforms as Record<string, { value: unknown }>;
        (ru.uSunUv.value as THREE.Vector2).set(screen.uv[0], screen.uv[1]);
        (ru.uIntensity.value as number) = screen.visible;
      }
      // DOF depth prepass (default off — the tick owns `pass.enabled`, so off
      // costs nothing and renders byte-identically to before). Shadows stay on
      // through the prepass: toggling them per frame would churn shader
      // programs, so the prepass simply pays the second shadow render.
      const dofState = sceneRef.current?.dof;
      const dofSettings = dofState ? dofSettingsFor(mode) : null;
      if (dofState) dofState.pass.enabled = dofOnRef.current && dofSettings != null;
      if (dofState && dofState.pass.enabled && dofSettings) {
        // Translucent fx layers would write solid depth — hide them for the
        // prepass (rider, road, terrain and markers keep true depth).
        const hidden: THREE.Object3D[] = [streaks, beacon, markerGroup];
        if (weatherFx) hidden.push(weatherFx);
        const prevVis = hidden.map((o) => o.visible);
        for (const o of hidden) o.visible = false;
        const prevOverride = scene.overrideMaterial;
        const prevTarget = renderer.getRenderTarget();
        scene.overrideMaterial = dofState.depth;
        renderer.setRenderTarget(dofState.rt);
        renderer.render(scene, camera);
        renderer.setRenderTarget(prevTarget);
        scene.overrideMaterial = prevOverride;
        hidden.forEach((o, i) => {
          o.visible = prevVis[i];
        });
        const du = dofState.pass.uniforms as Record<string, { value: unknown }>;
        (du.uFocus.value as number) = camera.position.distanceTo(rider.position);
        (du.uRange.value as number) = dofSettings.range;
        (du.uMaxBlur.value as number) = dofSettings.maxBlur;
      }
      if (composer) composer.render();
      else renderer.render(scene, camera);
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
        composer?.setSize(w, h);
        if (dof) syncDofTarget(dof, w, h, renderer.getPixelRatio());
        // Line2 widths are resolution-dependent — keep both materials in sync.
        pathMat.resolution.set(w, h);
        trailMat.resolution.set(w, h);
      }
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(mount);

    sceneRef.current = { renderer, controls, camera, scene, grid, rider, bike: null, trail, path: pathLine, pathGeo, roadGeo, roadMat, home: { pos: homePos, target: homeTarget }, terrain: null, composer, rays: godRaysPass, dof, dirLight, sky, cloud, hemiLight, headlamp };
    (window as unknown as { __relive?: unknown }).__relive = { scene, camera, controls, rider, sceneRef, drapeZ, zScale: build.zScale, points };
    // The fresh scene has no terrain bed — refetch if the user had it on.
    // A fresh scene has no terrain bed — force a reload/reattach (epoch bump so
    // the effect re-runs even if terrainState was mid-load).
    if (terrainStateRef.current !== 'off') {
      setTerrainState('loading');
      setTerrainEpoch((e) => e + 1);
    }

    const cleanup = () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      bikeCancelled = true;
      bikeRig?.dispose();
      ghostRig?.dispose();
      reflRig?.dispose();
      renderer.domElement.removeEventListener('dblclick', onDblClick);
      renderer.domElement.removeEventListener('mousedown', onMouseDown);
      renderer.domElement.removeEventListener('mouseup', onMouseUp);
      controls.dispose();
      pathGeo.dispose();
      pathMat.dispose();
      for (const rl of raceLines) {
        rl.line.geometry.dispose();
        rl.mat.dispose();
      }
      for (const mk of raceMarkers) {
        mk.mesh.geometry.dispose();
        mk.mat.dispose();
      }
      trailGeo.dispose();
      trailMat.dispose();
      roadGeo?.dispose();
      roadMat?.dispose();
      roadTex?.dispose();
      shadowGeo.dispose();
      shadowMat.dispose();
      shadowTex.dispose();
      beaconGeo.dispose();
      beaconMat.dispose();
      for (const z of zoneMeshes) {
        z.mesh.geometry.dispose();
        z.mat.dispose();
      }
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
      headlamp.dispose();
      sky.geometry.dispose();
      // Atmosphere dome holds uniforms only (no textures); the optional chain
      // keeps this correct if the material ever carries a map again.
      (sky.material as THREE.MeshBasicMaterial).map?.dispose();
      (sky.material as THREE.Material).dispose();
      if (cloud) {
        cloud.geometry.dispose();
        (cloud.material as THREE.Material).dispose();
      }
      composer?.dispose();
      // Composer disposal covers only its own targets — the DOF target, depth
      // material and pass belong to us.
      const dofGone = sceneRef.current?.dof;
      if (dofGone) {
        dofGone.rt.dispose();
        dofGone.depth.dispose();
        dofGone.pass.dispose();
      }
      weatherFx?.geometry.dispose();
      (weatherFx?.material as THREE.Material | undefined)?.dispose();
      streaks.geometry.dispose();
      (streaks.material as THREE.Material).dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement === mount) mount.removeChild(renderer.domElement);
      sceneRef.current = null;
    };
    return cleanup;
  }, [points, totalTime, build.totalDistance, liteMode, startDate, ghost, drapeZ, race]);

  // Recolour the path line + road ribbon without rebuilding the scene.
  useEffect(() => {
    const s = sceneRef.current;
    if (!s?.pathGeo || points.length < 2) return;
    const colors = replayPathColorArray(points, colorBy);
    const tinted = roadTint(colors);
    s.pathGeo.setColors(colors);
    const attr = s.roadGeo?.getAttribute('color') as THREE.BufferAttribute | undefined;
    if (attr && attr.count === points.length * 2) {
      const arr = attr.array as Float32Array;
      for (let i = 0; i < points.length; i++) {
        const c = i * 3;
        const o = i * 6;
        arr[o] = arr[o + 3] = tinted[c];
        arr[o + 1] = arr[o + 4] = tinted[c + 1];
        arr[o + 2] = arr[o + 5] = tinted[c + 2];
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
  const imageryStateRef = useRef(imageryState);
  useEffect(() => {
    imageryStateRef.current = imageryState;
  }, [imageryState]);

  // Fetch with a hard timeout so a slow/hung network request can't pin the
  // state in 'loading' forever. A timeout rejects with a plain Error (NOT
  // AbortError) so the caller's catch falls through to setTerrainState('failed')
  // — real signal aborts use AbortError and are ignored downstream.
  const fetchWithTimeout = <T,>(p: Promise<T>, ms = 30000, signal?: AbortSignal): Promise<T> =>
    new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout')), ms);
      if (signal) signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
      p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
    });

  // Shared progress handler for tile fetches: updates a ref (read per-frame)
  // and throttles React state to ~10fps so the overlay shows live progress.
  const onTileProgress = (loaded: number, total: number) => {
    loadProgressRef.current = { loaded, total };
    setLoadProgress((prev) => {
      if (!prev || prev.total !== total || loaded - prev.loaded >= Math.max(1, total / 20) || loaded === total) {
        return { loaded, total };
      }
      return prev;
    });
  };

  // ── Opt-in DEM terrain bed: high-res terrarium, Open-Meteo fallback ─────
  useEffect(() => {
    if (terrainState !== 'loading') return;
    if (!polyline) {
      setTerrainState('failed');
      return;
    }
    setLoadProgress(null);
    loadProgressRef.current = { loaded: 0, total: 0 };
    let cancelled = false;
    const controller = new AbortController();
    // Scene identity at fetch start. The fetch takes seconds; if the scene
    // rebuilds mid-fetch the completion bump may already be consumed, so an
    // unchecked attach can set 'on' on a dead scene while the live scene has
    // no bed (observed: state 'on' + null mesh + cleared overlay).
    const startedScene = sceneRef.current;
    (async () => {
      try {
        const coords = decodePolyline(polyline);
        let gridSpec: RouteGrid;
        let heights: number[];
        let attribution: string;
        try {
          const { fetchTerrariumTerrain, TERRARIUM_ATTRIBUTION } = await import('@/lib/terrainTiles');
          const res = await fetchWithTimeout(
            fetchTerrariumTerrain(coords, {
              maxTiles: 48,
              maxGridPoints: 131072,
              signal: controller.signal,
              onProgress: onTileProgress,
            }),
            30000,
          );
          gridSpec = res.grid;
          heights = res.heights;
          attribution = TERRARIUM_ATTRIBUTION;
        } catch (e) {
          if (e instanceof DOMException && e.name === 'AbortError') throw e;
          const [{ fetchTerrainResult }, { computeGrid }] = await Promise.all([
            import('@/lib/terrain'),
            import('@/lib/route3d'),
          ]);
          const g = computeGrid(coords);
          if (!g) throw new Error('no-grid');
          const res = await fetchWithTimeout(fetchTerrainResult(g, controller.signal), 30000);
          gridSpec = res.grid;
          heights = res.heights;
          attribution = 'Terrain © Open-Meteo — Copernicus DEM (GLO-90)';
        }
        if (cancelled) return;
        const { buildTerrainMesh, computeDrape } = await import('@/lib/route3d');
        const s = sceneRef.current;
        if (!s) {
          // Scene not built yet (effect ran before scene ready) — bail; the
          // terrainEpoch bump when the scene finishes will re-trigger loading.
          return;
        }
        // Drape the ride onto the DEM bed (pure helper — same frame for road,
        // bike, ghost and markers). Flat rides keep raw z (drape null).
        const { altMin, drape } = computeDrape(points, heights, gridSpec, {
          lat0: build.lat0,
          lng0: build.lng0,
          zScale: build.zScale,
        });
        const meshData = buildTerrainMesh(gridSpec, heights, {
          lat0: build.lat0,
          lng0: build.lng0,
          altMin,
          zScale: build.zScale,
          seaLevelM: 0,
        });
        const geo = new THREE.PlaneGeometry(1, 1, gridSpec.cols - 1, gridSpec.rows - 1);
        geo.setAttribute('position', new THREE.BufferAttribute(meshData.positions, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(meshData.colors, 3));
        geo.computeVertexNormals();
        const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.userData.grid = gridSpec;
        mesh.userData.heights = heights;
        mesh.userData.altMin = altMin;
        mesh.userData.zScale = build.zScale;
        mesh.receiveShadow = true;
        // The scene may have rebuilt while fetching — attach to the live one.
        const live = sceneRef.current;
        if (!live || cancelled) {
          geo.dispose();
          mat.dispose();
          // Scene was torn down mid-fetch (unmount/rebuild). Mark failed so the
          // user isn't stuck on an indefinite loading spinner with no feedback.
          if (!cancelled) setTerrainState('failed');
          return;
        }
        if (live !== startedScene) {
          // Rebuild completed mid-fetch and its completion bump already fired —
          // no further retry is coming. This mesh belongs to a dead scene:
          // dispose it, reset to loading and re-bump so the effect refetches
          // for the live scene instead of stranding state 'on' with no bed.
          geo.dispose();
          mat.dispose();
          setTerrainState('loading');
          setTerrainEpoch((e) => e + 1);
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
        setTerrainAttribution(attribution);
        setTerrainState('on');
        // Propagate the drape (only when it changed, to avoid a rebuild loop).
        if (drape) {
          const prev = drapeZRef.current;
          let changed = !prev || prev.length !== drape.length;
          if (!changed && prev) {
            for (let i = 0; i < drape.length; i++) {
              if (Math.abs(prev[i] - drape[i]) > 0.01) {
                changed = true;
                break;
              }
            }
          }
          if (changed) {
            drapeZRef.current = drape;
            setDrapeZ(drape);
          }
        } else if (drapeZRef.current) {
          drapeZRef.current = null;
          setDrapeZ(null);
        }
        // Re-drape imagery if it was already on.
        if (imageryStateRef.current === 'on') setImageryState('loading');
        // Re-trigger the imagery effect if it's still waiting: it runs on
        // mount before the terrain mesh exists (bare return, stays 'loading')
        // and nothing else re-runs it when there's no drape change to rebuild
        // the scene (flat rides) — the overlay would hang forever.
        if (imageryStateRef.current === 'loading') setTerrainEpoch((e) => e + 1);
      } catch (err) {
        if (cancelled || (err instanceof DOMException && err.name === 'AbortError')) return;
        // Terrain failures were completely silent, which made attach failures
        // undiagnosable — always log the cause.
        console.error('[Replay3D] terrain failed:', err instanceof Error ? `${err.name}: ${err.message}` : String(err));
        setTerrainState('failed');
        // Terrain failure also fails imagery — otherwise the imagery effect
        // stays stuck on 'loading' (no mesh to drape onto, no terrainEpoch
        // re-bump via the drapeZ→scene effect chain) and the loading overlay
        // never clears.
        if (imageryStateRef.current === 'loading') setImageryState('failed');
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [terrainState, polyline, points, build, terrainEpoch]);

  // ── Optional satellite imagery drape over the terrain (Phase 3) ────────
  useEffect(() => {
    if (imageryState !== 'loading') return;
    setLoadProgress(null);
    loadProgressRef.current = { loaded: 0, total: 0 };
    let cancelled = false;
    const controller = new AbortController();
    (async () => {
      try {
        const mesh = sceneRef.current?.terrain;
        const grid = mesh?.userData.grid as RouteGrid | undefined;
        if (!mesh || !grid) {
          // Terrain not attached yet (scene rebuild race) — stay in 'loading'
          // and retry when the terrain epoch bumps (mesh re-attaches).
          return;
        }
        const { fetchImageryDrape, imageryUv, IMAGERY_ATTRIBUTION } = await import('@/lib/imageryTiles');
        const drape = await fetchWithTimeout(
          fetchImageryDrape(grid, { maxTiles: 36, signal: controller.signal, onProgress: onTileProgress }),
          30000,
        );
        if (cancelled) return;
        const uv = new Float32Array(grid.rows * grid.cols * 2);
        for (let r = 0; r < grid.rows; r++) {
          for (let c = 0; c < grid.cols; c++) {
            const [u, v] = imageryUv(drape, grid.lats[r], grid.lngs[c]);
            const i = (r * grid.cols + c) * 2;
            uv[i] = u;
            uv[i + 1] = v;
          }
        }
        const tex = new THREE.CanvasTexture(drape.canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 4;
        const live = sceneRef.current?.terrain;
        if (!live || cancelled) {
          tex.dispose();
          if (!cancelled) setImageryState('failed');
          return;
        }
        // Satellite drape: lit material so it responds to the scene's day/night
        // lighting and ACES tone mapping (prevents the bloom blowout that
        // self-lit basic materials caused on bright terrain/water).
        const old = live.material as THREE.Material;
        live.material = new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide });
        old.dispose();
        live.geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
        setImageryAttribution(IMAGERY_ATTRIBUTION);
        setImageryState('on');
      } catch (err) {
        if (cancelled || (err instanceof DOMException && err.name === 'AbortError')) return;
        setImageryState('failed');
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [imageryState, terrainEpoch]);

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
      setImageryState('off');
      setImageryAttribution('');
      drapeZRef.current = null;
      setDrapeZ(null);
      try { window.localStorage?.setItem('relive:terrain', 'off'); } catch { /* ignore */ }
    } else if (terrainState === 'off' || terrainState === 'failed') {
      try { window.localStorage?.setItem('relive:terrain', 'on'); } catch { /* ignore */ }
      setTerrainState('loading');
    }
  };

  const toggleImagery = () => {
    userImageryToggledRef.current = true;
    if (imageryState === 'on') {
      const mesh = sceneRef.current?.terrain;
      const old = mesh?.material as THREE.MeshBasicMaterial | undefined;
      if (mesh && old) {
        old.map?.dispose();
        mesh.material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
        old.dispose();
      }
      setImageryState('off');
      setImageryAttribution('');
      try { window.localStorage?.setItem('relive:imagery', 'off'); } catch { /* ignore */ }
    } else if (imageryState === 'off' || imageryState === 'failed') {
      try { window.localStorage?.setItem('relive:imagery', 'on'); } catch { /* ignore */ }
      setImageryState('loading');
    }
  };

  // View presets always drop back to free-orbit first (follow cams own the camera).
  const resetView = () => {
    const s = sceneRef.current;
    if (!s?.home) return;
    setCamMode('orbit');
    s.camera.up.set(0, 0, 1);
    s.camera.position.copy(s.home.pos);
    s.controls.target.copy(s.home.target);
    s.controls.update();
  };

  // Restore the pre-shot mode when a scripted tour shot is abandoned.
  const cancelShot = () => {
    if (shotPathRef.current) {
      shotPathRef.current = null;
      shotKindRef.current = null;
      if (camModeRef.current === 'shot') setCamMode(preShotModeRef.current);
    }
  };

  // Play a scripted library shot for a beat, starting from the live camera
  // pose (no teleport cut). Falls back to a follow mode when unusable.
  const startBeatShot = (b: Beat) => {
    if (camModeRef.current !== 'shot') preShotModeRef.current = camModeRef.current;
    const s = sceneRef.current;
    const kind = pickBeatShot(b.kind);
    const path = buildShotPath(points, kind, b.startElapsed);
    if (!s || path.keyframes.length < 2) {
      setCamMode(b.kind === 'finale' ? 'flyby' : b.kind === 'comeback' ? 'drone' : 'chase');
      return;
    }
    // First keyframe = live pose so the shot eases in instead of jumping.
    const first = path.keyframes[0];
    first.position = [s.camera.position.x, s.camera.position.y, s.camera.position.z];
    const look = lookTargetRef.current;
    if (look) first.target = [look.x, look.y, look.z];
    first.fov = s.camera.fov;
    shotKindRef.current = kind;
    shotPathRef.current = path;
    shotStartRef.current = performance.now();
    setCamMode('shot');
  };

  const seek = (t: number) => {
    // A seek strands a wall-clock shot at a stale location — drop it first.
    cancelShot();
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

  // Story beats (what the rider did — attacks, comebacks, closing pushes).
  // Declared up here because tour entry seeks the first of highlights/beats.
  // The caption prefers terrain highlights; beats fill the gaps so the tour
  // always has something to say.
  const beats = useMemo(
    () => detectBeats(points, { ftpWatts: ftpWatts ?? undefined }),
    [points, ftpWatts]
  );
  const activeBeat = useMemo(
    () => (tour ? beatAt(beats, displayElapsed) : null),
    [tour, beats, displayElapsed]
  );

  // Lookahead: the next timeline event inside 3 minutes (highlights win
  // timestamp ties — terrain before story). Live even when not touring.
  const nextUp = useMemo(
    () => nextEvent([...highlights, ...beats], displayElapsed),
    [highlights, beats, displayElapsed]
  );

  // Entering the tour: jump to the first highlight (or story beat when the
  // route has no terrain features) and start playing. Chapter-chip jumps set
  // the suppress flag first — otherwise this effect yanks a non-first chapter
  // back to the start on the same render.
  const tourStart = highlights.length ? highlights[0].startElapsed : beats.length ? beats[0].startElapsed : null;
  const suppressTourEntryRef = useRef(false);
  useEffect(() => {
    if (!tour) suppressTourEntryRef.current = false;
  }, [tour]);
  useEffect(() => {
    if (!tour || tourStart == null || suppressTourEntryRef.current) return;
    seek(tourStart);
    if (!linkRef.current) setPlaying(true);
  }, [tour, tourStart]);

  // Keyboard shortcuts: space = play/pause, ←/→ = seek 15 s, 1–7 = cameras.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (e.code === 'Space') {
        e.preventDefault();
        toggle();
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        seek(displayElapsed + 15);
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        seek(displayElapsed - 15);
      } else if (e.key >= '1' && e.key <= '7') {
        // Same order as the toolbar: auto, orbit, chase, drone, cockpit, flyby, cinematic.
        const modes = ['auto', 'orbit', 'chase', 'drone', 'cockpit', 'flyby', 'cinematic'] as const;
        setCamMode(modes[Number(e.key) - 1]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle, seek, displayElapsed]);

  const takePoster = () => {
    const s = sceneRef.current;
    if (!s) return;
    // Render at 2x for a crisp poster, then restore the on-screen size.
    const el = s.renderer.domElement;
    const prevRatio = s.renderer.getPixelRatio();
    const w = el.clientWidth;
    const h = el.clientHeight;
    const render = () => {
      if (s.composer) s.composer.render();
      else s.renderer.render(s.scene, s.camera);
    };
    s.renderer.setPixelRatio(2);
    s.renderer.setSize(w, h, false);
    s.composer?.setPixelRatio(2);
    s.composer?.setSize(w, h);
    // The DOF depth target tracks the composer size, or the poster's blur
    // radius silently doubles.
    if (s.dof) syncDofTarget(s.dof, w, h, 2);
    s.camera.updateProjectionMatrix();
    render();
    el.toBlob((blob) => {
      s.renderer.setPixelRatio(prevRatio);
      s.renderer.setSize(w, h, false);
      s.composer?.setPixelRatio(prevRatio);
      s.composer?.setSize(w, h);
      if (s.dof) syncDofTarget(s.dof, w, h, prevRatio);
      s.camera.updateProjectionMatrix();
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${name.replace(/[^\w-]+/g, '_').slice(0, 40) || 'ride'}-3d.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, 'image/png');
  };

  const takeClip = () => {
    const s = sceneRef.current;
    if (!s || typeof MediaRecorder === 'undefined' || !s.renderer.domElement.captureStream) return;
    const stream = s.renderer.domElement.captureStream(30);
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(stream, { mimeType: 'video/webm' });
    } catch {
      rec = new MediaRecorder(stream);
    }
    const chunks: BlobPart[] = [];
    rec.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      const url = URL.createObjectURL(new Blob(chunks, { type: 'video/webm' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${name.replace(/[^\w-]+/g, '_').slice(0, 40) || 'ride'}-3d.webm`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    rec.start();
    window.setTimeout(() => {
      if (rec.state !== 'inactive') rec.stop();
    }, 6000);
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

  // Ghost delta: metres ahead (+) or behind (−) at the current time.
  const ghostDelta = useMemo(
    () => (ghost ? replayDistanceAt(points, displayElapsed) - replayDistanceAt(ghost.build.points, displayElapsed) : null),
    [ghost, points, displayElapsed]
  );

  // "Race Yourself" live standings: each ride's distance at the current time,
  // sorted leader-first, with delta vs. the leader.
  const raceStandings = useMemo(() => {
    // Same ≥2-point filter as the 3D markers — a degenerate trace would park
    // at 0 m and read as a bogus backmarker.
    const rides = (race ?? []).filter((r) => r.points.length >= 2);
    if (rides.length === 0) return null;
    const entries = rides.map((r) => {
      const idx = raceIndexAt(r.points, displayElapsed);
      const dist = r.points[idx]?.distance ?? 0;
      return { id: r.id, name: r.name, date: r.date, color: r.color, isPr: r.isPr, distance: dist, durationSeconds: r.durationSeconds };
    });
    entries.sort((a, b) => b.distance - a.distance);
    const leader = entries[0]?.distance ?? 0;
    return entries.map((e) => ({ ...e, delta: e.distance - leader }));
  }, [race, displayElapsed]);

  // Active highlight at the playhead (tour caption + camera director).
  const activeHighlight = useMemo(
    () => (tour ? highlightAt(highlights, displayElapsed) : null),
    [tour, highlights, displayElapsed]
  );
  useEffect(() => {
    activeHighlightRef.current = activeHighlight;
  }, [activeHighlight]);
  useEffect(() => {
    if (!tour) return;
    if (activeHighlight) {
      setCamMode(activeHighlight.kind === 'climb' ? 'drone' : 'chase');
      return;
    }
    // No terrain feature under the playhead — play the beat's signature
    // scripted shot instead of a plain follow mode.
    if (activeBeat) startBeatShot(activeBeat);
  }, [tour, activeHighlight, activeBeat]);

  if (failed) {
    return (
      <p className="rounded border border-surface-light bg-surface/40 p-3 text-sm text-muted">
        3D view isn&apos;t available in this browser — the 2D map above is used instead.
      </p>
    );
  }

  return (
    <div className={`${theater ? '' : 'rounded border border-surface-light bg-surface/40 p-3'}${photo ? ' photo' : ''}`}>
      {!theater && (
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted uppercase tracking-wide [.photo_&]:hidden">
        <span className="font-medium text-foreground">3D Flythrough</span>
        <span>{name}</span>
        <span className="ml-auto">{km} km · {timeFmt(totalTime)}</span>
      </div>
      )}

      <ReplayToolbar
        camMode={camMode}
        setCamMode={setCamMode}
        showBroadcast={showBroadcast}
        setShowBroadcast={setShowBroadcast}
        raysOn={raysOn}
        setRaysOn={setRaysOn}
        dofOn={dofOn}
        setDofOn={setDofOn}
        dofAvailable={!liteMode}
        audioOn={audioOn}
        toggleAudio={toggleAudio}
        tourAvailable={highlights.length > 0} // toolbar extracted
        tour={tour}
        setTour={setTour}
        terrainToggleable={!!polyline}
        terrainState={terrainState}
        toggleTerrain={toggleTerrain}
        imageryState={imageryState}
        toggleImagery={toggleImagery}
        resetView={resetView}
        takePoster={takePoster}
        takeClip={takeClip}
        photo={photo}
        setPhoto={setPhoto}
      />
      <div className={`relative ${photo ? 'h-[80dvh]' : canvasHeightClass} w-full touch-none overflow-hidden rounded bg-gradient-to-b from-surface/20 to-transparent`}>
        <div ref={mountRef} className="absolute inset-0" />
        {/* Photo mode hides the whole toolbar (including its own toggle), so
            this floating button is the way back out. */}
        {photo && (
          <button
            onClick={() => setPhoto(false)}
            className="absolute right-2 top-2 z-20 min-h-[44px] rounded-full border border-surface-light bg-surface/85 px-4 text-xs font-medium text-foreground backdrop-blur-sm transition-colors hover:bg-surface-light/60"
          >
            Exit photo
          </button>
        )}
        <ReplayLoadingOverlay
          sceneReady={sceneReady}
          terrainState={terrainState}
          imageryState={imageryState}
          failed={failed}
          loadProgress={loadProgress}
        />
        <div className="pointer-events-none absolute bottom-1 left-1 rounded bg-surface/70 px-1.5 py-0.5 text-[10px] text-muted [.photo_&]:hidden">
          drag to orbit · pinch to zoom · space play · ←/→ seek · 1–7 cameras · click route to jump
        </div>
        {perfMode === 'reduced' && (
          <div
            title="Effects auto-tuned for smooth playback — Rays/Focus can be re-enabled anytime"
            className="pointer-events-none absolute bottom-1 right-1 rounded bg-surface/70 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-muted [.photo_&]:hidden"
          >
            Performance mode{perfFps != null ? ` · ${perfFps} fps` : ''}
          </div>
        )}
        {(() => {
          // Terrain highlights win the caption; story beats fill the gaps;
          // otherwise look ahead to whatever comes next (tap to jump there).
          const story = activeHighlight ?? activeBeat;
          if (story) {
            return (
              <div className="pointer-events-none absolute bottom-2 left-1/2 max-w-[80%] -translate-x-1/2 rounded-lg border border-accent/30 bg-surface/85 px-3 py-1.5 text-center [.photo_&]:hidden">
                <p className="text-xs font-semibold text-accent">{story.label}</p>
                <p className="text-[11px] text-foreground">{story.detail}</p>
              </div>
            );
          }
          if (!nextUp) return null;
          return (
            <button
              onClick={() => seek(nextUp.event.startElapsed)}
              title="Jump to the next highlight"
              className="pointer-events-auto absolute bottom-2 left-1/2 max-w-[80%] -translate-x-1/2 rounded-full border border-surface-light bg-surface/70 px-3 py-1 text-[11px] text-muted backdrop-blur-sm transition-colors hover:border-accent/30 hover:text-foreground [.photo_&]:hidden"
            >
              Up next: <span className="font-medium text-foreground/80">{nextUp.event.label}</span>
              {' · in '}
              <span className="font-mono tabular-nums">{timeFmt(nextUp.inSeconds)}</span>
            </button>
          );
        })()}
        {/* ── Broadcast HUD: live ride data overlay ─────────────────────────── */}
        {hud && showBroadcast && (
          <div className="pointer-events-none absolute left-2 top-2 z-10 w-44 rounded-lg border border-surface-light/50 bg-surface/80 p-2 font-mono text-[10px] tabular-nums backdrop-blur-sm [.photo_&]:hidden">
            {/* Header: ride name + camera mode */}
            <div className="mb-1.5 flex items-center justify-between border-b border-surface-light/40 pb-1">
              <span className="truncate text-[9px] font-semibold uppercase tracking-wide text-muted">{name}</span>
              <span className="rounded bg-accent/20 px-1 text-[8px] text-accent">{(camMode === 'auto' ? resolvedAuto : camMode).toUpperCase()}</span>
            </div>
            {/* Speed — the hero number */}
            <div className="mb-1 flex items-baseline gap-1">
              <span className="text-lg font-bold leading-none text-foreground">{hud.kmh.toFixed(1)}</span>
              <span className="text-[9px] text-muted">km/h</span>
            </div>
            {/* Metric rows */}
            <div className="space-y-0.5">
              {hud.power != null && (
                <div className="flex items-center justify-between">
                  <span className="text-muted">PWR</span>
                  <span className="font-semibold" style={{ color: powerZoneColor(hud.power, ftpWatts) }}>
                    {Math.round(hud.power)} <span className="text-[8px] text-muted">W</span>
                  </span>
                </div>
              )}
              {hud.hr != null && (
                <div className="flex items-center justify-between">
                  <span className="text-muted">HR</span>
                  <span className="font-semibold text-rose-400">{Math.round(hud.hr)} <span className="text-[8px] text-muted">bpm</span></span>
                </div>
              )}
              {hud.cadence != null && (
                <div className="flex items-center justify-between">
                  <span className="text-muted">CAD</span>
                  <span className="font-semibold text-violet-400">{Math.round(hud.cadence)} <span className="text-[8px] text-muted">rpm</span></span>
                </div>
              )}
              {hud.grade != null && (
                <div className="flex items-center justify-between">
                  <span className="text-muted">GRAD</span>
                  <span className={hud.grade >= 0 ? 'font-semibold text-amber-400' : 'font-semibold text-sky-400'}>
                    {hud.grade >= 0 ? '+' : ''}{hud.grade.toFixed(1)}<span className="text-[8px] text-muted">%</span>
                  </span>
                </div>
              )}
            </div>
            {/* Progress bar through the ride */}
            <div className="mt-1.5 border-t border-surface-light/40 pt-1">
              <div className="flex items-center justify-between text-[8px] text-muted">
                <span>{(replayDistanceAt(points, displayElapsed) / 1000).toFixed(1)} km</span>
                <span>{timeFmt(displayElapsed)}</span>
              </div>
              <div className="mt-0.5 h-0.5 overflow-hidden rounded-full bg-surface-light">
                <div className="h-full rounded-full bg-accent" style={{ width: `${(displayElapsed / totalTime) * 100}%` }} />
              </div>
            </div>
            {/* Ghost delta */}
            {ghostDelta != null && (
              <div className={`mt-1 text-right text-[9px] font-semibold ${ghostDelta >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {ghostDelta >= 0 ? '+' : '−'}
                {Math.abs(ghostDelta) >= 1000
                  ? `${(Math.abs(ghostDelta) / 1000).toFixed(2)} km`
                  : `${Math.round(Math.abs(ghostDelta))} m`}
              </div>
            )}
          </div>
        )}
        {/* Compact HUD (top-right) when broadcast is off */}
        {hud && !showBroadcast && (
          <div className="pointer-events-none absolute right-1 top-1 rounded bg-surface/70 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-foreground [.photo_&]:hidden">
            {hud.kmh.toFixed(1)} km/h
            {hud.power != null && <span style={{ color: powerZoneColor(hud.power, ftpWatts) }}> · {Math.round(hud.power)} W</span>}
            {hud.hr != null && <span className="text-rose-400"> · {Math.round(hud.hr)} bpm</span>}
            {hud.cadence != null && <span className="text-violet-400"> · {Math.round(hud.cadence)} rpm</span>}
            {hud.grade != null && (
              <span className="text-emerald-400"> · {hud.grade >= 0 ? '+' : ''}{hud.grade.toFixed(1)}%</span>
            )}
            {ghostDelta != null && (
              <span className={ghostDelta >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                {' · '}{ghostDelta >= 0 ? '+' : '−'}
                {Math.abs(ghostDelta) >= 1000 ? `${(Math.abs(ghostDelta) / 1000).toFixed(2)} km` : `${Math.round(Math.abs(ghostDelta))} m`}
              </span>
            )}
          </div>
        )}
      </div>

      {(highlights.length > 0 || beats.length > 0) && (
        <div className="mt-1.5 flex gap-1 overflow-x-auto pb-0.5 [.photo_&]:hidden" role="group" aria-label="Ride highlights and story beats">
          {highlights.map((h, i) => (
            <button
              key={`${h.kind}-${i}`}
              onClick={() => {
                suppressTourEntryRef.current = true;
                setTour(true);
                seek(h.startElapsed);
              }}
              title={h.detail}
              className={`shrink-0 rounded-full border px-2.5 py-0.5 min-h-[32px] text-[10px] transition-colors ${
                activeHighlight === h
                  ? 'border-accent/50 bg-accent/20 text-accent'
                  : 'border-surface-light text-muted hover:border-accent/30'
              }`}
            >
              {h.label}
            </button>
          ))}
          {beats.map((b, i) => (
            <button
              key={`${b.kind}-${i}`}
              onClick={() => {
                suppressTourEntryRef.current = true;
                setTour(true);
                seek(b.startElapsed);
                // Play this beat's shot immediately — the tour effect would
                // also catch it, but only after the playhead render lands.
                startBeatShot(b);
              }}
              title={b.detail}
              className={`shrink-0 rounded-full border border-dashed px-2.5 py-0.5 min-h-[32px] text-[10px] transition-colors ${
                activeBeat === b
                  ? 'border-violet-400/60 bg-violet-400/20 text-violet-300'
                  : 'border-surface-light text-muted hover:border-violet-400/40'
              }`}
            >
              {b.label}
            </button>
          ))}
        </div>
      )}

      {/* Race Yourself legend — coloured traces for other rides on the route */}
      {race && race.some((r) => r.points.length >= 2) && (
        <div className="mt-2 hidden flex-wrap items-center gap-x-3 gap-y-1 text-[11px] [.photo_&]:hidden sm:flex">
          <span className="uppercase tracking-wide text-muted">Rides</span>
          {race.filter((r) => r.points.length >= 2).map((r) => (
            <span key={r.id} className="inline-flex items-center gap-1.5">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: r.color }}
                aria-hidden="true"
              />
              <span className="text-muted">{new Date(r.date).toLocaleDateString()}</span>
              {r.isPr && <span className="text-amber-400" title="Personal best">★</span>}
              {r.durationSeconds != null && (
                <span className="text-foreground/70">
                  {(() => {
                    // Round total seconds first: Math.round(s % 60) alone can
                    // print "1:60" (e.g. 119.6 s → 1 min + 60 s).
                    const total = Math.round(r.durationSeconds);
                    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
                  })()}
                </span>
              )}
            </span>
          ))}
        </div>
      )}

      {/* Race Yourself live standings — leader-first with deltas (orbit view) */}
      {raceStandings && raceStandings.length >= 2 && (
        <div className="mt-1 hidden rounded border border-surface-light bg-surface/60 p-2 text-[11px] [.photo_&]:hidden sm:block">
          <div className="mb-1 flex items-center gap-2">
            <span className="uppercase tracking-wide text-muted">Race</span>
            <span className="text-muted/70">{timeFmt(displayElapsed)}</span>
          </div>
          <div className="flex flex-col gap-0.5">
            {raceStandings.map((s, i) => (
              <div key={s.id} className="flex items-center gap-2">
                <span className="w-4 text-right font-mono text-muted">{i + 1}.</span>
                <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-foreground/80">{new Date(s.date).toLocaleDateString()}</span>
                <span className="font-mono tabular-nums text-foreground">{(s.distance / 1000).toFixed(2)} km</span>
                <span
                  className={`w-14 text-right font-mono tabular-nums ${
                    i === 0 ? 'text-emerald-400' : s.delta < -50 ? 'text-rose-400' : 'text-muted'
                  }`}
                >
                  {i === 0 ? 'leader' : `${(s.delta / 1000).toFixed(2)} km`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Path colour mode + scale + telemetry in one compact block (desktop only on mobile) */}
      <div className="mt-2 hidden sm:block [.photo_&]:hidden">
        <div className="flex items-center gap-2">
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
                  title={available ? `Colour by ${m}` : `No ${m} data`}
                  className={`rounded px-2 py-1 min-h-[44px] sm:min-h-[36px] min-w-[44px] sm:min-w-[36px] text-[11px] capitalize transition-colors disabled:opacity-30 ${
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
        <div className="mt-1.5">
          <TelemetryStrip
            points={points}
            playhead={displayElapsed}
            elevationBase={{ altMin: build.altMin, zScale: build.zScale }}
            ftpWatts={ftpWatts}
          />
        </div>
        {terrainState === 'on' && (
          <p className="mt-0.5 text-[9px] text-muted/60">
            {terrainAttribution}
            {imageryState === 'on' && imageryAttribution ? ` · ${imageryAttribution}` : ''}
          </p>
        )}
      </div>

      {/* Transport + profile + scrubber */}
      <div className="mt-2 [.photo_&]:hidden">
        <div className="flex flex-wrap items-center gap-2">
          {link ? (
            <span
              title="Playback follows the compare master clock"
              className="inline-flex min-h-[44px] sm:min-h-[36px] items-center rounded bg-accent/20 px-3 py-1 text-sm font-medium text-accent"
            >
              Linked
            </span>
          ) : (
            <>
              <button
                onClick={toggle}
                className="rounded bg-accent px-4 py-1 min-h-[48px] sm:min-h-[36px] text-base sm:text-sm font-medium text-accent-foreground transition-colors hover:bg-accent/90"
              >
                {playing ? 'Pause' : 'Play'}
              </button>
              <div className="flex items-center gap-0.5" role="group" aria-label="Playback speed">
                {tourOptions.map((o) => (
                  <button
                    key={o.label}
                    onClick={() => pickRate(o.rate)}
                    title={`Whole ride in ~${o.label} (${o.rate}×)`}
                    className={`rounded px-2 py-1 min-h-[44px] sm:min-h-[36px] min-w-[44px] sm:min-w-[36px] text-[11px] transition-colors ${
                      rate === o.rate ? 'bg-accent/20 text-accent' : 'text-muted hover:bg-surface-light/40'
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </>
          )}
          <span className="ml-auto font-mono text-xs tabular-nums text-muted">
            {timeFmt(displayElapsed)} / {timeFmt(totalTime)}
          </span>
        </div>
        <CourseProfile points={points} totalDistance={build.totalDistance} elapsed={displayElapsed} onSeek={seek} />
        <input
          type="range"
          min={0}
          max={totalTime}
          step={0.1}
          value={displayElapsed}
          onChange={(e) => seek(Number(e.target.value))}
          aria-label="Replay scrubbing"
          className="mt-1 h-11 sm:h-9 w-full accent-accent"
        />
        {startDate && (
          <div className="mt-1 hidden items-center gap-2 sm:flex">
            <span
              className="text-[10px] text-muted"
              title="Ride start time drives the lighting — drag to explore other times of day"
            >
              {(() => {
                const rideTime = new Date(startDate);
                const shifted = new Date(rideTime.getTime() + timeOffsetH * 3600_000);
                const sun = solarPosition(shifted, build.lat0, build.lng0);
                const phase = daylightPhase(sun.elevationDeg);
                const icon = phase === 'night' ? '🌙' : phase === 'blue' ? '🌆' : phase === 'golden' ? '🌅' : '☀';
                const hh = shifted.getHours();
                const mm = String(shifted.getMinutes()).padStart(2, '0');
                return (
                  <>
                    <span aria-hidden>{icon}</span>{' '}
                    <span className="font-mono tabular-nums">{hh}:{mm}</span>{' '}
                    <span className="text-muted/60">
                      {phase === 'night' ? 'night' : phase === 'blue' ? 'blue hour' : phase === 'golden' ? 'golden hour' : 'daylight'}
                    </span>
                  </>
                );
              })()}
            </span>
            <input
              type="range"
              min={-12}
              max={12}
              step={0.5}
              value={timeOffsetH}
              onChange={(e) => setTimeOffsetH(Number(e.target.value))}
              aria-label="Time of day — drag to re-light the scene"
              className="h-7 flex-1 accent-amber-400"
            />
            {timeOffsetH !== 0 && (
              <button
                onClick={() => setTimeOffsetH(0)}
                title="Back to the ride's actual start time"
                className="rounded border border-surface-light px-1.5 py-0.5 text-[10px] text-muted transition-colors hover:bg-surface-light/40"
              >
                Reset
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}