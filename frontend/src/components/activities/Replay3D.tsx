'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { ReplayBuildResult, ReplayPoint } from '@/lib/replay';
import { timeFmt } from '@/lib/replay';
import { decodePolyline } from '@/lib/polyline';

const SLOW_COLOR = new THREE.Color('#3b82f6');
const FAST_COLOR = new THREE.Color('#ef4444');
const TRAIL_COLOR = new THREE.Color('#22d3ee');
const RIDER_COLOR = new THREE.Color('#ffffff');

function speedColor(t: number): THREE.Color {
  const clamped = Math.max(0, Math.min(1, t));
  return SLOW_COLOR.clone().lerp(FAST_COLOR, clamped);
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

/** Telephone-style SVG strip: power + HR traces with a playhead (no Recharts, stays lean). */
export function TelemetryStrip({
  points,
  playhead,
  height = 72,
}: {
  points: ReplayPoint[];
  playhead: number;
  height?: number;
}) {
  const power = useMemo(() => points.map((p) => p.power), [points]);
  const hr = useMemo(() => points.map((p) => p.hr), [points]);
  const maxPower = useMemo(() => Math.max(1, ...power.filter((v): v is number => v != null)), [power]);
  const maxHr = useMemo(() => Math.max(1, ...hr.filter((v): v is number => v != null)), [hr]);

  const W = 200;
  const H = height;
  const n = Math.max(2, points.length);

  const polyline = (values: (number | null)[], m: number, rowTop: number, rowBot: number): string => {
    let d = '';
    values.forEach((v, i) => {
      if (v == null) return;
      const x = (i / (n - 1)) * W;
      const y = rowBot - ((v / m) * (rowBot - rowTop));
      d += `${d ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return d;
  };

  const playheadX = (Math.max(0, Math.min(playhead, (points.at(-1)?.elapsed ?? 0))) /
    Math.max(1, points.at(-1)?.elapsed ?? 0)) * W;

  return (
    <div className="w-full overflow-hidden rounded border border-surface-light bg-surface/40">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="block h-[72px] w-full"
        aria-hidden
      >
        <line x1={0} y1={H * 0.5} x2={W} y2={H * 0.5} stroke="rgba(148,163,184,0.15)" strokeWidth={0.4} />
        <path d={polyline(hr, maxHr, H * 0.08, H * 0.42)} fill="none" stroke="#f59e0b" strokeWidth={0.8} strokeLinejoin="round" />
        <path d={polyline(power, maxPower, H * 0.55, H * 0.9)} fill="none" stroke="#3b82f6" strokeWidth={0.8} strokeLinejoin="round" />
        {playhead > 0 && (
          <line x1={playheadX} y1={0} x2={playheadX} y2={H} stroke="rgba(255,255,255,0.8)" strokeWidth={0.6} />
        )}
      </svg>
      <div className="flex justify-between px-2 py-1 text-[10px] uppercase tracking-wide text-muted">
        <span className="text-amber-400">HR</span>
        <span className="text-blue-400">Power</span>
      </div>
    </div>
  );
}

/** 3D ride replay — animated rider marker along the recording path (§3.16).
 *  Camera modes: free-orbit (default), chase, and cockpit follow cams.
 *  Terrain bed is opt-in (button) so the activities page stays light. */
export function Replay3D({
  name,
  build,
  polyline,
}: {
  name: string;
  build: ReplayBuildResult;
  /** encoded polyline — required only for the opt-in terrain bed */
  polyline?: string;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(4);
  const [displayElapsed, setDisplayElapsed] = useState(0);
  const [camMode, setCamMode] = useState<'orbit' | 'chase' | 'cockpit'>('orbit');
  const [terrainState, setTerrainState] = useState<'off' | 'loading' | 'on' | 'failed'>('off');

  const points = build.points;
  const totalTime = build.totalTime;

  const sceneRef = useRef<{
    renderer: THREE.WebGLRenderer;
    controls: OrbitControls;
    camera: THREE.PerspectiveCamera;
    scene: THREE.Scene;
    grid: THREE.GridHelper;
    rider: THREE.Mesh;
    trail: THREE.Line;
    terrain: THREE.Mesh | null;
  } | null>(null);

  // Playback clock lives in refs so the rAF loop reads the freshest values
  // without a React render per frame.
  const playingRef = useRef(false);
  const rateRef = useRef(rate);
  const elapsedRef = useRef(0);
  const camModeRef = useRef(camMode);
  const followPosRef = useRef<THREE.Vector3 | null>(null);

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);
  useEffect(() => {
    rateRef.current = rate;
  }, [rate]);
  useEffect(() => {
    camModeRef.current = camMode;
    // Re-seed follow smoothing from wherever the orbit camera is now.
    followPosRef.current = null;
    // Retarget orbit pivots to the rider when returning to free-orbit.
    const s = sceneRef.current;
    if (s && camMode === 'orbit') {
      s.controls.target.copy(s.rider.position);
    }
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
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      if (!renderer.getContext()) throw new Error('no-webgl');
    } catch {
      setFailed(true);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);

    const scene = new THREE.Scene();
    // Lights for the opt-in DEM terrain bed (basic materials ignore them).
    scene.add(new THREE.AmbientLight(0xffffff, 0.65));
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.1);
    const grid = new THREE.GridHelper(2, 24, 0x334155, 0x1e293b);
    scene.add(grid);
    const camera = new THREE.PerspectiveCamera(
      55,
      mount.clientWidth / mount.clientHeight,
      0.1,
      50000
    );

    const minX = Math.min(...points.map((p) => p.x));
    const maxX = Math.max(...points.map((p) => p.x));
    const minY = Math.min(...points.map((p) => p.y));
    const maxY = Math.max(...points.map((p) => p.y));
    const minZ = Math.min(...points.map((p) => p.z));
    const maxZ = Math.max(...points.map((p) => p.z));
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const size = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 100);
    // Shift grid to sit under the lowest point so the path floats above ground.
    grid.position.set(cx, cy, Math.max(minZ - size * 0.08, 0));
    dirLight.position.set(cx + size * 0.6, cy - size * 0.5, minZ + size);
    scene.add(dirLight);

    const dist = size * 2.2;
    camera.position.set(cx + size * 0.5, cy - size * 0.7, minZ + dist);
    camera.lookAt(cx, cy, minZ + size * 0.3);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.target.set(cx, cy, minZ + size * 0.3);

    // ── Path line, vertex-colored by speed ───────────────────────────────
    const positions = new Float32Array(points.length * 3);
    const colors = new Float32Array(points.length * 3);
    let maxSpeed = 1;
    for (const p of points) maxSpeed = Math.max(maxSpeed, p.speed);
    points.forEach((p, i) => {
      positions[i * 3] = p.x;
      positions[i * 3 + 1] = p.y;
      positions[i * 3 + 2] = p.z;
      const c = speedColor(p.speed / maxSpeed);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    });
    const pathGeo = new THREE.BufferGeometry();
    pathGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    pathGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const pathMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85 });
    scene.add(new THREE.Line(pathGeo, pathMat));

    // ── Ridden trail (grows via setDrawRange) ────────────────────────────
    const trailPositions = new Float32Array(points.length * 3);
    trailPositions.set(positions);
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
    trailGeo.setDrawRange(0, 0);
    const trailMat = new THREE.LineBasicMaterial({ color: TRAIL_COLOR, transparent: true, opacity: 0.5 });
    const trail = new THREE.Line(trailGeo, trailMat);
    scene.add(trail);

    // ── Rider marker: cone oriented along the heading ────────────────────
    const riderGeo = new THREE.ConeGeometry(size * 0.018, size * 0.05, 12);
    const rider = new THREE.Mesh(riderGeo, new THREE.MeshBasicMaterial({ color: RIDER_COLOR }));
    scene.add(rider);
    const riderDir = new THREE.Vector3(1, 0, 0);
    const UP_Y = new THREE.Vector3(0, 1, 0);
    const UP_Z = new THREE.Vector3(0, 0, 1);

    // ── Km markers: dot + distance label at regular intervals ──────────────
    const markerGroup = new THREE.Group();
    scene.add(markerGroup);
    const markerDisposables: { dispose: () => void }[] = [];
    {
      const totalKm = build.totalDistance / 1000;
      const intervalKm = totalKm > 150 ? 25 : totalKm > 60 ? 10 : 5;
      const dotGeo = new THREE.SphereGeometry(Math.max(size * 0.006, 1.5), 10, 10);
      const dotMat = new THREE.MeshBasicMaterial({ color: 0x94a3b8 });
      markerDisposables.push(dotGeo, dotMat);
      for (let k = intervalKm; k < totalKm; k += intervalKm) {
        const target = k * 1000;
        const idx = points.findIndex((pt) => pt.distance >= target);
        if (idx < 0) continue;
        const mp = points[idx];
        const dot = new THREE.Mesh(dotGeo, dotMat);
        dot.position.set(mp.x, mp.y, mp.z);
        markerGroup.add(dot);
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.font = 'bold 36px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = 'rgba(15,23,42,0.65)';
          const label = `${k}`;
          const w = ctx.measureText(label).width + 28;
          ctx.beginPath();
          ctx.roundRect((128 - w) / 2, 6, w, 52, 12);
          ctx.fill();
          ctx.fillStyle = '#e2e8f0';
          ctx.fillText(label, 64, 33);
        }
        const tex = new THREE.CanvasTexture(canvas);
        const spriteMat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
        const sprite = new THREE.Sprite(spriteMat);
        sprite.scale.set(size * 0.09, size * 0.045, 1);
        sprite.position.set(mp.x, mp.y, mp.z + size * 0.03);
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
    const tmpDir = new THREE.Vector3();
    const tmpDesired = new THREE.Vector3();
    const tmpLook = new THREE.Vector3();
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (playingRef.current) {
        elapsedRef.current += dt * rateRef.current;
        if (elapsedRef.current >= totalTime) {
          elapsedRef.current = totalTime;
          playingRef.current = false;
          setPlaying(false);
        }
      }
      const i = nearestIndex(points, elapsedRef.current);
      const p = points[i];
      rider.position.set(p.x, p.y, p.z);
      // Heading from a look-ahead sample (stable at standstill).
      const j = Math.min(points.length - 1, i + 8);
      const q = points[j];
      tmpDir.set(q.x - p.x, q.y - p.y, q.z - p.z);
      if (tmpDir.lengthSq() > 1e-9) riderDir.copy(tmpDir.normalize());
      rider.quaternion.setFromUnitVectors(UP_Y, riderDir);
      trailGeo.setDrawRange(0, i + 1);

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
          const dist = size * 0.3;
          const height = size * 0.15;
          const hLen = Math.hypot(riderDir.x, riderDir.y) || 1;
          tmpDesired.set(
            p.x - (riderDir.x / hLen) * dist,
            p.y - (riderDir.y / hLen) * dist,
            p.z + height
          );
          tmpLook.set(
            p.x + riderDir.x * size * 0.05,
            p.y + riderDir.y * size * 0.05,
            p.z + riderDir.z * size * 0.05
          );
        } else {
          // cockpit: eyes on the path ahead.
          tmpDesired.set(p.x, p.y, p.z + size * 0.008);
          tmpLook.set(
            p.x + riderDir.x * size * 0.5,
            p.y + riderDir.y * size * 0.5,
            p.z + riderDir.z * size * 0.5
          );
        }
        if (!followPosRef.current) followPosRef.current = tmpDesired.clone();
        const k = 1 - Math.exp(-dt * 4);
        followPosRef.current.lerp(tmpDesired, k);
        camera.position.copy(followPosRef.current);
        camera.lookAt(tmpLook);
      }
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

    sceneRef.current = { renderer, controls, camera, scene, grid, rider, trail, terrain: null };
    // The fresh scene has no terrain bed — refetch if the user had it on.
    if (terrainStateRef.current === 'on') setTerrainState('loading');

    const cleanup = () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      pathGeo.dispose();
      pathMat.dispose();
      trailGeo.dispose();
      trailMat.dispose();
      riderGeo.dispose();
      (rider.material as THREE.Material).dispose();
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
      renderer.dispose();
      if (renderer.domElement.parentElement === mount) mount.removeChild(renderer.domElement);
      sceneRef.current = null;
    };
    return cleanup;
  }, [points, totalTime, build.totalDistance]);

  // Push display-elapsed to React ~10fps for the scrubber/readout too.
  useEffect(() => {
    const id = window.setInterval(() => {
      setDisplayElapsed(elapsedRef.current);
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

  const seek = (t: number) => {
    elapsedRef.current = Math.max(0, Math.min(totalTime, t));
    setDisplayElapsed(elapsedRef.current);
  };

  const toggle = () => {
    if (!playing && elapsedRef.current >= totalTime - 0.01) elapsedRef.current = 0;
    setPlaying((p) => !p);
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
    };
  }, [points, displayElapsed]);

  if (failed) {
    return (
      <p className="rounded border border-surface-light bg-surface/40 p-3 text-sm text-muted">
        3D view isn&apos;t available in this browser — the 2D map above is used instead.
      </p>
    );
  }

  return (
    <div className="rounded border border-surface-light bg-surface/40 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted uppercase tracking-wide">
        <span className="font-medium text-foreground">3D Flythrough</span>
        <span>{name}</span>
        <span className="ml-auto">{km} km · {timeFmt(totalTime)}</span>
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="flex items-center rounded border border-surface-light" role="group" aria-label="Camera mode">
          {(['orbit', 'chase', 'cockpit'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setCamMode(m)}
              aria-pressed={camMode === m}
              title={m === 'orbit' ? 'Free orbit camera' : m === 'chase' ? 'Follow behind the rider' : 'Rider point of view'}
              className={`rounded px-2 py-1 min-h-[44px] min-w-[44px] text-xs capitalize transition-colors ${
                camMode === m ? 'bg-accent/20 text-accent' : 'text-muted hover:bg-surface-light/40'
              }`}
            >
              {m}
            </button>
          ))}
        </div>
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
      </div>

      <div className="relative h-[300px] w-full overflow-hidden rounded bg-gradient-to-b from-surface/20 to-transparent">
        <div ref={mountRef} className="absolute inset-0" />
        <div className="pointer-events-none absolute bottom-1 left-1 rounded bg-surface/70 px-1.5 py-0.5 text-[10px] text-muted">
          drag sideways to orbit · pinch to zoom
        </div>
        {hud && (
          <div className="pointer-events-none absolute right-1 top-1 rounded bg-surface/70 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-foreground">
            {hud.kmh.toFixed(1)} km/h
            {hud.power != null && <span className="text-blue-400"> · {Math.round(hud.power)} W</span>}
            {hud.hr != null && <span className="text-amber-400"> · {Math.round(hud.hr)} bpm</span>}
          </div>
        )}
      </div>

      {/* Path colour scale: vertex-coloured by speed (blue → red). */}
      <div className="mt-2 flex flex-1 flex-col gap-0.5" aria-hidden>
        <div
          className="h-1.5 w-full rounded-full"
          style={{ background: 'linear-gradient(to right, #3b82f6, #ef4444)' }}
        />
        <div className="flex justify-between text-[10px] tabular-nums text-muted">
          <span>0 km/h</span>
          <span>{maxKmh.toFixed(0)} km/h</span>
        </div>
      </div>

      <TelemetryStrip points={points} playhead={displayElapsed} />
      {terrainState === 'on' && (
        <p className="mt-1 text-[10px] text-muted">Terrain © Open-Meteo — Copernicus DEM (GLO-90)</p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          onClick={toggle}
          className="rounded bg-accent px-3 py-1 min-h-[44px] text-sm font-medium text-accent-foreground transition-colors hover:bg-accent/90"
        >
          {playing ? 'Pause' : 'Play'}
        </button>
        <div className="flex items-center gap-1">
          {[1, 4, 8].map((r) => (
            <button
              key={r}
              onClick={() => setRate(r)}
              className={`rounded px-2 py-1 min-h-[44px] min-w-[44px] text-xs transition-colors ${
                rate === r ? 'bg-accent/20 text-accent' : 'text-muted hover:bg-surface-light/40'
              }`}
            >
              {r}×
            </button>
          ))}
        </div>
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