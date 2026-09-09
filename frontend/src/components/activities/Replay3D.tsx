'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { ReplayBuildResult, ReplayPoint } from '@/lib/replay';
import { timeFmt } from '@/lib/replay';

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

/** 3D ride replay — camera fly-through along the recording path (§3.16 MVP). */
export function Replay3D({
  name,
  build,
}: {
  name: string;
  build: ReplayBuildResult;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(4);
  const [displayElapsed, setDisplayElapsed] = useState(0);

  const points = build.points;
  const totalTime = build.totalTime;

  const sceneRef = useRef<{
    renderer: THREE.WebGLRenderer;
    controls: OrbitControls;
    rider: THREE.Mesh;
    trail: THREE.Line;
    camController?: { stop: () => void };
  } | null>(null);

  // Playback clock lives in refs so the rAF loop reads the freshest values
  // without a React render per frame.
  const playingRef = useRef(false);
  const rateRef = useRef(rate);
  const elapsedRef = useRef(0);

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);
  useEffect(() => {
    rateRef.current = rate;
  }, [rate]);

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
    scene.add(new THREE.GridHelper(2, 24, 0x334155, 0x1e293b));

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
    const grid = scene.children.find((c) => c instanceof THREE.GridHelper) as THREE.GridHelper;
    grid.position.set(cx, cy, Math.max(minZ - size * 0.08, 0));

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

    // ── Rider marker ─────────────────────────────────────────────────────
    const rider = new THREE.Mesh(
      new THREE.SphereGeometry(size * 0.015, 16, 16),
      new THREE.MeshBasicMaterial({ color: RIDER_COLOR })
    );
    scene.add(rider);

    mount.appendChild(renderer.domElement);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    // Let vertical page scrolls pass through on touch (OrbitControls sets
    // touch-action:none); horizontal drags still orbit, pinch still zooms.
    renderer.domElement.style.touchAction = 'pan-y';

    let raf = 0;
    let last = performance.now();
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
      trailGeo.setDrawRange(0, i + 1);
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

    sceneRef.current = { renderer, controls, rider, trail };

    const cleanup = () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      pathGeo.dispose();
      pathMat.dispose();
      trailGeo.dispose();
      trailMat.dispose();
      rider.geometry.dispose();
      (rider.material as THREE.Material).dispose();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
      sceneRef.current = null;
    };
    return cleanup;
  }, [points, totalTime]);

  // Push display-elapsed to React ~10fps for the scrubber/readout too.
  useEffect(() => {
    const id = window.setInterval(() => {
      setDisplayElapsed(elapsedRef.current);
    }, 100);
    return () => window.clearInterval(id);
  }, []);

  const seek = (t: number) => {
    elapsedRef.current = Math.max(0, Math.min(totalTime, t));
    setDisplayElapsed(elapsedRef.current);
  };

  const toggle = () => {
    if (!playing && elapsedRef.current >= totalTime - 0.01) elapsedRef.current = 0;
    setPlaying((p) => !p);
  };

  const km = (build.totalDistance / 1000).toFixed(1);

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

      <div className="relative h-[300px] w-full overflow-hidden rounded bg-gradient-to-b from-surface/20 to-transparent">
        <div ref={mountRef} className="absolute inset-0" />
        <div className="pointer-events-none absolute bottom-1 left-1 rounded bg-surface/70 px-1.5 py-0.5 text-[10px] text-muted">
          drag sideways to orbit · pinch to zoom
        </div>
      </div>

      <TelemetryStrip points={points} playhead={displayElapsed} />

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