/**
 * Particle-effect factories for the Relive 3D viewer (extracted from Replay3D).
 *
 * Creation only — per-frame animation stays in the component's RAF tick.
 * Factories return detached objects; the caller adds them to the scene and
 * disposes them on teardown (same lifecycle as before the extraction).
 */

import * as THREE from 'three';
import type { WeatherFxType } from '@/lib/three/weather';

/**
 * Camera-relative rain/snow/haze particle system, or null for clear skies.
 * Intensity scales with precipitation. Rain = streaks (LineSegments),
 * snow/haze = soft drifting points.
 */
export function createWeatherFx(
  weatherType: WeatherFxType | null,
  precipIntensity: number,
): THREE.Points | THREE.LineSegments | null {
  if (!weatherType) return null;
  let fx: THREE.Points | THREE.LineSegments;
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
    fx = new THREE.LineSegments(geo, mat);
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
    fx = new THREE.Points(geo, mat);
  }
  fx.frustumCulled = false;
  return fx;
}

export interface StreakSample {
  x: number;
  y: number;
  z: number;
  speed: number;
}

export interface SpeedStreaks {
  points: THREE.Points;
  mat: THREE.PointsMaterial;
  /** live position buffer (length COUNT*3) — the tick writes into it */
  pos: Float32Array;
  /** per-point intensity (length COUNT) — the tick writes into it */
  alpha: Float32Array;
  /** ring buffer of recent rider positions for streak spawning */
  history: StreakSample[];
  count: number;
}

/**
 * Motion-trail point pool streaming behind the bike. Density and length scale
 * with speed; tinted by effort in the tick.
 */
export function createSpeedStreaks(count = 400): SpeedStreaks {
  const pos = new Float32Array(count * 3);
  const alpha = new Float32Array(count);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    size: 0.9,
    transparent: true,
    opacity: 0.5,
    vertexColors: false,
    color: 0x38bdf8,
    sizeAttenuation: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  return { points, mat, pos, alpha, history: [], count };
}
