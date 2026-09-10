'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { decodePolyline } from '@/lib/polyline';
import type { BuildRoute3DResult, ColorMode, RoutePathPoint, TerrainInput } from '@/lib/route3d';
import { DESCENT_COLOR, ELEVATION_RAMP, GRADE_RAMP, GRADE_SCALE, buildRoute3D, computeGrid, pointColor, steepestKm } from '@/lib/route3d';
import type { Segment } from '@/lib/api/types';

const START_COLOR = new THREE.Color('#22c55e');
const END_COLOR = new THREE.Color('#ef4444');
const CLIMB_COLOR = 0xfb923c;
const SUMMIT_COLOR = new THREE.Color('#facc15');
const HIGHLIGHT_COLOR = new THREE.Color('#22d3ee');

/** flat RGB array for the drape LineGeometry under a colour mode */
function routeLineColors(
  path: RoutePathPoint[],
  mode: ColorMode,
  altMin: number,
  altSpan: number
): number[] {
  const col = new Array<number>(path.length * 3);
  path.forEach((p, i) => {
    const [r, g, b] = pointColor(p, mode, altMin, altSpan);
    col[i * 3] = r;
    col[i * 3 + 1] = g;
    col[i * 3 + 2] = b;
  });
  return col;
}

/** nearest path point to a route distance (km) — robust across resamplings */
function nearestPointByDistKm(path: RoutePathPoint[], km: number): RoutePathPoint {
  let bi = 0;
  let bd = Infinity;
  path.forEach((p, i) => {
    const d = Math.abs(p.distKm - km);
    if (d < bd) {
      bd = d;
      bi = i;
    }
  });
  return path[bi];
}

/** 1/2/5-style nice number for the in-scene scale bar (metres) */
function niceScale(raw: number): number {
  if (!(raw > 0)) return 100;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / pow;
  return (n >= 5 ? 5 : n >= 2 ? 2 : 1) * pow;
}

function fmtScale(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(m % 1000 ? 1 : 0)} km` : `${Math.round(m)} m`;
}

/** 3D route drape over a DEM heightmap (§3.16 — route view). */
export function Route3D({
  polyline,
  elevations = null,
  name,
  className,
  segments = null,
  highlightDistKm = null,
}: {
  polyline: string;
  elevations?: (number | null)[] | null;
  name: string;
  className?: string;
  /** §3.13 climb segments — highlighted as orange spans with name labels */
  segments?: Segment[] | null;
  /** hover distance from the 2D profile (km) — gold-free cyan marker, no rebuild */
  highlightDistKm?: number | null;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const [terrainState, setTerrainState] = useState<'loading' | 'ready' | 'failed' | 'none'>('loading');
  const [terrain, setTerrain] = useState<TerrainInput | null>(null);
  const [mode, setMode] = useState<ColorMode>('elevation');
  const [zUser, setZUser] = useState<number | null>(null);

  const coords = useMemo(() => decodePolyline(polyline), [polyline]);

  // Fetch the DEM grid once per route change.
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setTerrain(null);
    setTerrainState('loading');
    (async () => {
      const grid = computeGrid(coords);
      if (!grid) {
        setTerrainState('none');
        return;
      }
      try {
        const { fetchTerrainResult } = await import('@/lib/terrain');
        const result = await fetchTerrainResult(grid, controller.signal);
        if (cancelled) return;
        setTerrain(result);
        setTerrainState('ready');
      } catch (err) {
        if (cancelled || (err instanceof DOMException && err.name === 'AbortError')) return;
        setTerrainState('failed');
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [polyline]);

  const build = useMemo<BuildRoute3DResult>(
    () =>
      buildRoute3D({
        coords,
        elevations: elevations ?? undefined,
        terrain,
        maxPathSamples: 1500,
        zScale: zUser ?? undefined,
      }),
    [coords, elevations, terrain, zUser]
  );

  const sceneRef = useRef<{
    renderer: THREE.WebGLRenderer;
    controls: OrbitControls;
    camera: THREE.PerspectiveCamera;
    lineGeo: LineGeometry | null;
    highlight: THREE.Mesh | null;
    dispose: () => void;
  } | null>(null);
  const cameraPoseRef = useRef<{ pos: THREE.Vector3; target: THREE.Vector3 } | null>(null);

  const hasElevations = useMemo(
    () => elevations?.some((e) => typeof e === 'number') ?? false,
    [elevations]
  );

  // Scene construction (rebuilt when DEM lands so the terrain mesh appears).
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || build.path.length < 2) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      if (!renderer.getContext()) throw new Error('no-webgl');
    } catch {
      setFailed(true);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      50,
      mount.clientWidth / mount.clientHeight,
      0.1,
      200000
    );

    const points = build.path;
    const minX = Math.min(...points.map((p) => p.x));
    const maxX = Math.max(...points.map((p) => p.x));
    const minY = Math.min(...points.map((p) => p.y));
    const maxY = Math.max(...points.map((p) => p.y));
    const minZ = Math.min(...points.map((p) => p.z));
    const maxZ = Math.max(...points.map((p) => p.z));
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const cz = (minZ + maxZ) / 2;
    const size = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 60);

    scene.add(new THREE.AmbientLight(0xffffff, 0.65));
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.1);
    dirLight.position.set(size * 0.6, -size * 0.5, size);
    scene.add(dirLight);

    // ── Terrain bed from the DEM grid (same frame as the path) ───────────
    const geos: THREE.BufferGeometry[] = [];
    const mats: THREE.Material[] = [];
    if (build.terrainVerts) {
      const cols = terrain?.grid.cols ?? 0;
      const rows = terrain?.grid.rows ?? 0;
      if (cols > 1 && rows > 1) {
        const terrainGeo = new THREE.PlaneGeometry(1, 1, cols - 1, rows - 1);
        terrainGeo.setAttribute('position', new THREE.BufferAttribute(build.terrainVerts.positions, 3));
        terrainGeo.setAttribute('color', new THREE.BufferAttribute(build.terrainVerts.colors, 3));
        terrainGeo.computeVertexNormals();
        const terrainMat = new THREE.MeshLambertMaterial({ vertexColors: true });
        scene.add(new THREE.Mesh(terrainGeo, terrainMat));
        geos.push(terrainGeo);
        mats.push(terrainMat);
      }
    }

    // ── Route line, vertex-coloured by mode (Line2: constant width) ──────
    const pathGeo = new LineGeometry();
    const pathPos: number[] = [];
    points.forEach((p) => {
      pathPos.push(p.x, p.y, p.z);
    });
    pathGeo.setPositions(pathPos);
    pathGeo.setColors(routeLineColors(points, mode, build.altMin, build.altSpan));
    const pathMat = new LineMaterial({ linewidth: 3, vertexColors: true });
    pathMat.resolution.set(mount.clientWidth, mount.clientHeight);
    scene.add(new Line2(pathGeo, pathMat));
    geos.push(pathGeo);
    mats.push(pathMat);

    // ── Start / end markers ───────────────────────────────────────────────
    const markerGeo = new THREE.SphereGeometry(Math.max(size * 0.009, 3), 16, 16);
    const start = new THREE.Mesh(markerGeo, new THREE.MeshBasicMaterial({ color: START_COLOR }));
    const end = new THREE.Mesh(markerGeo, new THREE.MeshBasicMaterial({ color: END_COLOR }));
    start.position.set(points[0].x, points[0].y, points[0].z);
    const last = points[points.length - 1];
    end.position.set(last.x, last.y, last.z);
    scene.add(start, end);
    geos.push(markerGeo);
    mats.push(start.material, end.material);

    // ── Label sprites (canvas pills, always face the camera) ──────────────
    const labelDisposables: { dispose: () => void }[] = [];
    const addLabel = (text: string, x: number, y: number, z: number, worldH: number) => {
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 64;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.font = 'bold 30px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const w = Math.min(248, ctx.measureText(text).width + 30);
        ctx.fillStyle = 'rgba(15,23,42,0.7)';
        const x0 = (256 - w) / 2;
        if (typeof ctx.roundRect === 'function') {
          ctx.beginPath();
          ctx.roundRect(x0, 8, w, 48, 10);
          ctx.fill();
        } else {
          ctx.fillRect(x0, 8, w, 48);
        }
        ctx.fillStyle = '#e2e8f0';
        ctx.fillText(text, 128, 33);
      }
      const tex = new THREE.CanvasTexture(canvas);
      const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
      const sprite = new THREE.Sprite(mat);
      sprite.scale.set(worldH * 4, worldH, 1);
      sprite.position.set(x, y, z);
      scene.add(sprite);
      labelDisposables.push({ dispose: () => { tex.dispose(); mat.dispose(); } });
    };

    // ── Climb spans (§3.13 segments): orange overlay + name label ──────────
    if (segments?.length) {
      for (const seg of segments) {
        const span = points.filter(
          (p) => p.distKm * 1000 >= seg.start_dist_m && p.distKm * 1000 <= seg.end_dist_m
        );
        if (span.length >= 2) {
          const g = new THREE.BufferGeometry();
          const arr = new Float32Array(span.length * 3);
          span.forEach((p, i) => {
            arr[i * 3] = p.x;
            arr[i * 3 + 1] = p.y;
            arr[i * 3 + 2] = p.z + size * 0.004;
          });
          g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
          const m = new THREE.LineBasicMaterial({ color: CLIMB_COLOR });
          scene.add(new THREE.Line(g, m));
          geos.push(g);
          mats.push(m);
        }
        const s0 = nearestPointByDistKm(points, seg.start_dist_m / 1000);
        const dot = new THREE.Mesh(
          new THREE.SphereGeometry(Math.max(size * 0.007, 2), 10, 10),
          new THREE.MeshBasicMaterial({ color: CLIMB_COLOR })
        );
        dot.position.set(s0.x, s0.y, s0.z);
        scene.add(dot);
        geos.push(dot.geometry);
        mats.push(dot.material);
        addLabel(seg.name.slice(0, 20), s0.x, s0.y, s0.z + size * 0.05, size * 0.028);
      }
    }

    // ── Summit marker (highest path elevation) ────────────────────────────
    const summit = points.reduce((a, b) => ((b.elevation ?? -Infinity) > (a.elevation ?? -Infinity) ? b : a), points[0]);
    if (summit.elevation != null) {
      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(Math.max(size * 0.008, 2.5), 12, 12),
        new THREE.MeshBasicMaterial({ color: SUMMIT_COLOR })
      );
      dot.position.set(summit.x, summit.y, summit.z);
      scene.add(dot);
      geos.push(dot.geometry);
      mats.push(dot.material);
      addLabel(`${Math.round(summit.elevation)} m`, summit.x, summit.y, summit.z + size * 0.05, size * 0.028);
    }

    // ── North arrow (+Y is north in the path frame) ───────────────────────
    const arrowOrigin = new THREE.Vector3(minX - size * 0.05, minY - size * 0.13, maxZ);
    const arrow = new THREE.ArrowHelper(
      new THREE.Vector3(0, 1, 0),
      arrowOrigin,
      size * 0.09,
      0x94a3b8,
      size * 0.025,
      size * 0.014
    );
    scene.add(arrow);
    arrow.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Line) {
        geos.push(o.geometry);
        const m = o.material as THREE.Material | THREE.Material[];
        (Array.isArray(m) ? m : [m]).forEach((mm) => mats.push(mm));
      }
    });
    addLabel('N', arrowOrigin.x, arrowOrigin.y + size * 0.115, arrowOrigin.z, size * 0.026);

    // ── Scale bar (world units — truthful at any camera distance) ─────────
    const barLen = niceScale(Math.max(maxX - minX, maxY - minY) / 5);
    {
      const y0 = minY - size * 0.06;
      const g = new THREE.BufferGeometry();
      g.setAttribute(
        'position',
        new THREE.BufferAttribute(
          new Float32Array([minX, y0, minZ, minX + barLen, y0, minZ]),
          3
        )
      );
      const m = new THREE.LineBasicMaterial({ color: 0x94a3b8 });
      scene.add(new THREE.Line(g, m));
      geos.push(g);
      mats.push(m);
      addLabel(fmtScale(barLen), minX + barLen / 2, y0, minZ + size * 0.03, size * 0.024);
    }

    // ── 2D-profile hover marker (positioned by effect, no rebuild) ────────
    const highlight = new THREE.Mesh(
      new THREE.SphereGeometry(Math.max(size * 0.012, 3.5), 12, 12),
      new THREE.MeshBasicMaterial({ color: HIGHLIGHT_COLOR, depthTest: false, transparent: true, opacity: 0.95 })
    );
    highlight.visible = false;
    highlight.renderOrder = 10;
    scene.add(highlight);
    geos.push(highlight.geometry);
    mats.push(highlight.material);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;

    // Preserve the user's orbit across the terrain-arrival rebuild.
    const prev = cameraPoseRef.current;
    if (prev) {
      camera.position.copy(prev.pos);
      controls.target.copy(prev.target);
    } else {
      camera.position.set(cx + size * 0.5, cy - size * 0.7, cz + size * 1.9);
      controls.target.set(cx, cy, cz);
    }
    camera.lookAt(controls.target);
    controls.update();

    mount.appendChild(renderer.domElement);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    // Let vertical page scrolls pass through on touch (OrbitControls sets
    // touch-action:none); horizontal drags still orbit, pinch still zooms.
    renderer.domElement.style.touchAction = 'pan-y';

    let raf = 0;
    const tick = () => {
      controls.update();
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
        // Line2 widths are resolution-dependent.
        pathMat.resolution.set(w, h);
      }
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(mount);

    sceneRef.current = {
      renderer,
      controls,
      camera,
      lineGeo: pathGeo,
      highlight,
      dispose: () => {
        cameraPoseRef.current = { pos: camera.position.clone(), target: controls.target.clone() };
        cancelAnimationFrame(raf);
        ro.disconnect();
        controls.dispose();
        geos.forEach((g) => g.dispose());
        mats.forEach((m) => m.dispose());
        labelDisposables.forEach((d) => d.dispose());
        renderer.dispose();
        mount.removeChild(renderer.domElement);
        sceneRef.current = null;
      },
    };

    return () => sceneRef.current?.dispose();
  }, [build, terrain, segments]);

  // Colour the path line whenever the mode or data changes.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene?.lineGeo || build.path.length < 2) return;
    scene.lineGeo.setColors(routeLineColors(build.path, mode, build.altMin, build.altSpan));
  }, [build, mode]);

  // Position the 2D-profile hover marker without rebuilding the scene.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene?.highlight || build.path.length < 2) return;
    if (highlightDistKm == null) {
      scene.highlight.visible = false;
      return;
    }
    const p = nearestPointByDistKm(build.path, highlightDistKm);
    scene.highlight.position.set(p.x, p.y, p.z);
    scene.highlight.visible = true;
  }, [highlightDistKm, build]);

  const topClimb = useMemo(
    () =>
      segments?.length
        ? [...segments].sort((a, b) => b.elevation_gain_m - a.elevation_gain_m)[0]
        : null,
    [segments]
  );
  const steep = useMemo(() => steepestKm(build.path), [build]);
  const frameTarget = topClimb
    ? { aKm: topClimb.start_dist_m / 1000, bKm: topClimb.end_dist_m / 1000, label: 'top climb' as const }
    : steep
      ? { aKm: steep.startKm, bKm: steep.endKm, label: 'steepest km' as const }
      : null;

  const frameClimb = () => {
    const scene = sceneRef.current;
    if (!scene || !frameTarget || build.path.length < 2) return;
    const pa = nearestPointByDistKm(build.path, frameTarget.aKm);
    const pb = nearestPointByDistKm(build.path, frameTarget.bKm);
    const mx = (pa.x + pb.x) / 2;
    const my = (pa.y + pb.y) / 2;
    const mz = (pa.z + pb.z) / 2;
    const span = Math.max(60, Math.hypot(pb.x - pa.x, pb.y - pa.y, pb.z - pa.z));
    scene.controls.target.set(mx, my, mz);
    scene.camera.position.set(mx + span * 0.6, my - span * 0.8, mz + span * 1.1);
    scene.camera.lookAt(scene.controls.target);
    scene.controls.update();
  };

  const legendStops = mode === 'elevation' ? ELEVATION_RAMP : GRADE_RAMP;
  const legendGradient =
    mode === 'elevation'
      ? `linear-gradient(to right, ${legendStops.map(([, hex]) => hex).join(', ')})`
      : `linear-gradient(to right, ${DESCENT_COLOR}, ${legendStops.map(([, hex]) => hex).join(', ')})`;
  const legendLow = mode === 'elevation' ? `${build.altMin.toFixed(0)} m` : `${Math.max(-GRADE_SCALE, build.minSlopePct).toFixed(0)}%`;
  const legendHigh =
    mode === 'elevation'
      ? `${build.altMax.toFixed(0)} m`
      : `${Math.min(GRADE_SCALE, build.maxSlopePct).toFixed(0)}%`;

  const flatDrape =
    terrainState === 'failed' && !hasElevations
      ? 'Terrain elevation unavailable — showing the route in profile-flat view.'
      : terrainState === 'failed'
        ? 'DEM terrain unavailable — draped from stored route elevation.'
        : terrainState === 'none'
          ? 'Route geometry too small to build terrain.'
          : null;

  if (failed) {
    return (
      <p className="rounded border border-surface-light bg-surface/40 p-3 text-sm text-muted">
        3D view isn&apos;t available in this browser — the 2D profile above is used instead.
      </p>
    );
  }

  if (build.path.length < 1) {
    return (
      <p className="rounded border border-surface-light bg-surface/40 p-3 text-sm text-muted">
        Route geometry unavailable.
      </p>
    );
  }

  return (
    <div className={`rounded border border-surface-light bg-surface/40 p-3 ${className ?? ''}`}>
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted uppercase tracking-wide">
        <span className="font-medium text-foreground">3D Terrain</span>
        <span>{name}</span>
        <span className="ml-auto">
          {Math.round(build.altMax - build.altMin)} m relief · {build.path.length} pts
          {segments?.length ? ` · ${segments.length} climb${segments.length === 1 ? '' : 's'}` : ''}
        </span>
      </div>

      <div className="relative h-[320px] w-full overflow-hidden rounded bg-gradient-to-b from-surface/20 to-transparent">
        <div ref={mountRef} className="absolute inset-0" />
        <div className="pointer-events-none absolute bottom-1 left-1 rounded bg-surface/70 px-1.5 py-0.5 text-[10px] text-muted">
          drag sideways to orbit · pinch to zoom
        </div>
        {terrainState === 'loading' && (
          <div className="pointer-events-none absolute right-1 top-1 rounded bg-surface/70 px-1.5 py-0.5 text-[10px] text-muted">
            loading terrain…
          </div>
        )}
      </div>

      {/* Colour mode + legend */}
      <div className="mt-2 flex items-center gap-2">
        <div className="flex items-center rounded border border-surface-light">
          {(['elevation', 'slope'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`rounded px-2 py-0.5 min-h-[44px] min-w-[44px] text-xs capitalize transition-colors ${
                mode === m ? 'bg-accent/20 text-accent' : 'text-muted hover:bg-surface-light/40'
              }`}
            >
              {m}
            </button>
          ))}
        </div>
        <div className="ml-1 flex flex-1 flex-col gap-0.5">
          <div className="h-1.5 w-full rounded-full" style={{ background: legendGradient }} aria-hidden />
          <div className="flex justify-between text-[10px] tabular-nums text-muted">
            <span>{legendLow}</span>
            <span>{legendHigh}</span>
          </div>
        </div>
      </div>

      {flatDrape && <p className="mt-2 text-[11px] text-muted">{flatDrape}</p>}

      {/* Vertical exaggeration + climb framing */}
      <div className="mt-2 flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wide text-muted">Relief</span>
        <input
          type="range"
          min={1}
          max={15}
          step={0.5}
          value={zUser ?? build.zScale}
          onChange={(e) => setZUser(Number(e.target.value))}
          aria-label="Vertical exaggeration"
          className="h-8 flex-1 accent-accent"
        />
        <span className="font-mono text-[10px] tabular-nums text-muted">
          ×{(zUser ?? build.zScale).toFixed(1)}
        </span>
        {zUser != null && (
          <button
            onClick={() => setZUser(null)}
            className="rounded px-2 py-0.5 min-h-[44px] text-xs text-muted hover:bg-surface-light/40"
          >
            Auto
          </button>
        )}
        {frameTarget && (
          <button
            onClick={frameClimb}
            title={topClimb ? `${topClimb.name}: ${(topClimb.distance_m / 1000).toFixed(1)} km, ${topClimb.elevation_gain_m.toFixed(0)} m gain` : `${steep!.avgGradePct.toFixed(1)}% avg over 1 km`}
            className="rounded border border-surface-light px-2 py-1 min-h-[44px] text-xs text-muted transition-colors hover:bg-surface-light/40"
          >
            Frame {frameTarget.label}
          </button>
        )}
      </div>
      {terrainState === 'ready' && (
        <p className="mt-2 text-[10px] text-muted">
          Terrain © Open-Meteo — Copernicus DEM (GLO-90)
        </p>
      )}
    </div>
  );
}