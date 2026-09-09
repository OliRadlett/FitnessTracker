'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { decodePolyline } from '@/lib/polyline';
import type { BuildRoute3DResult, ColorMode, TerrainInput } from '@/lib/route3d';
import { ELEVATION_RAMP, GRADE_RAMP, GRADE_SCALE, buildRoute3D, computeGrid, pointColor } from '@/lib/route3d';

const START_COLOR = new THREE.Color('#22c55e');
const END_COLOR = new THREE.Color('#ef4444');

/** three.js 3D route drape over a DEM heightmap (§3.16 — route view). */
export function Route3D({
  polyline,
  elevations = null,
  name,
  className,
}: {
  polyline: string;
  elevations?: (number | null)[] | null;
  name: string;
  className?: string;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const [terrainState, setTerrainState] = useState<'loading' | 'ready' | 'failed' | 'none'>('loading');
  const [terrain, setTerrain] = useState<TerrainInput | null>(null);
  const [mode, setMode] = useState<ColorMode>('elevation');

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
    () => buildRoute3D({ coords, elevations: elevations ?? undefined, terrain, maxPathSamples: 1500 }),
    [coords, elevations, terrain]
  );

  const sceneRef = useRef<{
    renderer: THREE.WebGLRenderer;
    controls: OrbitControls;
    camera: THREE.PerspectiveCamera;
    lineColor: THREE.BufferAttribute | null;
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

    // ── Route line, vertex-coloured by mode ───────────────────────────────
    const pathGeo = new THREE.BufferGeometry();
    const pathPos = new Float32Array(points.length * 3);
    const pathCol = new Float32Array(points.length * 3);
    points.forEach((p, i) => {
      pathPos[i * 3] = p.x;
      pathPos[i * 3 + 1] = p.y;
      pathPos[i * 3 + 2] = p.z;
    });
    const colorAttr = new THREE.BufferAttribute(pathCol, 3);
    colorAttr.setUsage(THREE.DynamicDrawUsage);
    pathGeo.setAttribute('position', new THREE.BufferAttribute(pathPos, 3));
    pathGeo.setAttribute('color', colorAttr);
    const pathMat = new THREE.LineBasicMaterial({ vertexColors: true });
    scene.add(new THREE.Line(pathGeo, pathMat));
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
      }
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(mount);

    sceneRef.current = {
      renderer,
      controls,
      camera,
      lineColor: colorAttr,
      dispose: () => {
        cameraPoseRef.current = { pos: camera.position.clone(), target: controls.target.clone() };
        cancelAnimationFrame(raf);
        ro.disconnect();
        controls.dispose();
        geos.forEach((g) => g.dispose());
        mats.forEach((m) => m.dispose());
        renderer.dispose();
        mount.removeChild(renderer.domElement);
        sceneRef.current = null;
      },
    };

    return () => sceneRef.current?.dispose();
  }, [build, terrain]);

  // Colour the path line whenever the mode or data changes.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene?.lineColor || build.path.length < 2) return;
    const col = new Float32Array(build.path.length * 3);
    build.path.forEach((p, i) => {
      const [r, g, b] = pointColor(p, mode, build.altMin, build.altSpan);
      col[i * 3] = r;
      col[i * 3 + 1] = g;
      col[i * 3 + 2] = b;
    });
    scene.lineColor.array = col;
    scene.lineColor.needsUpdate = true;
  }, [build, mode]);

  const legendStops = mode === 'elevation' ? ELEVATION_RAMP : GRADE_RAMP;
  const legendGradient = `linear-gradient(to right, ${legendStops.map(([, hex]) => hex).join(', ')})`;
  const legendLow = mode === 'elevation' ? `${build.altMin.toFixed(0)} m` : '0%';
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
        </span>
      </div>

      <div className="relative h-[320px] w-full overflow-hidden rounded bg-gradient-to-b from-surface/20 to-transparent">
        <div ref={mountRef} className="absolute inset-0" />
        <div className="pointer-events-none absolute bottom-1 left-1 rounded bg-surface/70 px-1.5 py-0.5 text-[10px] text-muted">
          drag to orbit · scroll to zoom · right-drag to pan
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
              className={`rounded px-2 py-0.5 text-xs capitalize transition-colors ${
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
      {terrainState === 'ready' && (
        <p className="mt-2 text-[10px] text-muted">
          Terrain © Open-Meteo — Copernicus DEM (GLO-90)
        </p>
      )}
    </div>
  );
}