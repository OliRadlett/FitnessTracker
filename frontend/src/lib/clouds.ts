import * as THREE from 'three';
import { parseCardinal } from './three/weather';

/**
 * Procedural cloud shell for the Relive viewer (next-level Phase A).
 *
 * A transparent dome inside the sky dome carrying animated fbm cloud masses:
 * coverage follows the ride weather, the sun side gets a warm silver lining,
 * night dims the layer toward fog. No textures, no extra fetches — pure GPU
 * noise driven by uniforms. The component follows the camera with it and
 * advances `uTime` once per frame; everything else updates on sun/weather
 * changes only.
 */

export interface CloudWeather {
  overcast: boolean;
  rainy: boolean;
  snowy: boolean;
  foggy: boolean;
}

export interface CloudFactors {
  /** 0 clear → ~0.9 heavy rain (fraction of sky covered) */
  coverage: number;
  /** overall layer opacity */
  opacity: number;
  /** sun-edge silver-lining strength */
  silver: number;
  /** warm tint on lit clouds near sunrise/sunset */
  warmth: number;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** Pure mapping from solar elevation + weather to cloud uniforms. */
export function cloudFactors(
  elevationDeg: number,
  weather: CloudWeather | null
): CloudFactors {
  const e = Number.isFinite(elevationDeg) ? elevationDeg : -18;
  let coverage = 0.32; // fair-weather wisps — a dead-clear CG sky looks fake
  if (weather) {
    if (weather.overcast) coverage = Math.max(coverage, 0.8);
    if (weather.foggy) coverage = Math.max(coverage, 0.7);
    if (weather.snowy) coverage = Math.max(coverage, 0.85);
    if (weather.rainy) coverage = Math.max(coverage, 0.9);
  }
  const night = 1 - smoothstep(-8, -2, e);
  const dayAmount = smoothstep(-2, 2, e);
  // An overcast sun has no sharp edge to silver-line.
  let grey = 0;
  if (weather) {
    if (weather.overcast) grey = Math.max(grey, 0.55);
    if (weather.foggy) grey = Math.max(grey, 0.55);
    if (weather.snowy) grey = Math.max(grey, 0.7);
    if (weather.rainy) grey = Math.max(grey, 0.8);
  }
  return {
    coverage,
    opacity: 0.9 * (1 - night * 0.35),
    silver: dayAmount * (1 - night * 0.8) * (1 - grey * 0.6),
    warmth: 1 - smoothstep(5, 35, e),
  };
}

/** Styled cloud palette (linear-space via THREE.Color at upload). */
export const CLOUD_LIT = '#dfe7f2';
export const CLOUD_SHADE = '#59616f';

/**
 * Ride wind (km/h + cardinal "from" direction) → cloud-plane drift in UV/s.
 * Slow enough to read as mass, fast enough to notice in a 10 s hold.
 */
export function cloudWindVec(
  speedKmh: number | null | undefined,
  dirCardinal: string | null | undefined
): [number, number] {
  const speed = Math.min(40, Math.max(0, speedKmh ?? 0)) * 0.0022;
  if (!(speed > 0)) return [0.004, 0.0015]; // faint default drift on calm days
  const deg = parseCardinal(dirCardinal ?? null);
  const rad = ((deg + 180) % 360) * (Math.PI / 180); // "from" → flow vector
  return [Math.sin(rad) * speed, Math.cos(rad) * speed * 0.6];
}

export interface CloudState {
  sunDirection: [number, number, number];
  baseColor: string;
  darkColor: string;
  fog: string;
  nightFactor: number;
  coverage: number;
  opacity: number;
  silver: number;
  warmth: number;
  wind: [number, number];
}

const CLOUD_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const CLOUD_FRAG = /* glsl */ `
varying vec3 vDir;
uniform vec3 uSunDir;
uniform float uTime;
uniform float uCoverage;
uniform float uOpacity;
uniform float uSilver;
uniform float uNightFactor;
uniform float uWarmth;
uniform vec3 uBaseColor;
uniform vec3 uDarkColor;
uniform vec3 uFogColor;
uniform vec2 uWind;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * vnoise(p);
    p = p * 2.03 + vec2(17.3, 9.1);
    a *= 0.5;
  }
  return v;
}

void main() {
  vec3 dir = normalize(vDir);
  float h = dir.y;
  float horizonFade = smoothstep(0.02, 0.22, h);
  // Planar projection of the overhead sky; drift with the ride wind + time.
  vec2 cuv = dir.xz / (abs(h) + 0.25);
  vec2 flow = cuv * 1.6 + uWind * uTime;
  float n = fbm(flow);
  float d = smoothstep(1.0 - uCoverage - 0.28, 1.0 - uCoverage + 0.32, n);
  float shade = fbm(flow * 2.1 + 4.7);
  vec3 lit = mix(uBaseColor, vec3(1.0, 0.62, 0.38), uWarmth * 0.55);
  vec3 col = mix(uDarkColor, lit, shade);
  // Silver lining on the sun side of each mass.
  float s = pow(max(dot(dir, uSunDir), 0.0), 18.0);
  col += vec3(1.0, 0.8, 0.55) * s * uSilver;
  col = mix(col, uFogColor * 0.55, uNightFactor * 0.85);
  float alpha = d * uOpacity * horizonFade * (1.0 - uNightFactor * 0.45);
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** Transparent animated cloud shell (sits inside the sky dome). */
export function createCloudDome(radius: number): THREE.Mesh {
  const geo = new THREE.SphereGeometry(radius, 32, 16);
  const mat = new THREE.ShaderMaterial({
    vertexShader: CLOUD_VERT,
    fragmentShader: CLOUD_FRAG,
    uniforms: {
      uSunDir: { value: new THREE.Vector3(0.5, -0.5, 0.8) },
      uTime: { value: 0 },
      uCoverage: { value: 0.32 },
      uOpacity: { value: 0.9 },
      uSilver: { value: 1 },
      uNightFactor: { value: 0 },
      uWarmth: { value: 0 },
      uBaseColor: { value: new THREE.Color(CLOUD_LIT) },
      uDarkColor: { value: new THREE.Color(CLOUD_SHADE) },
      uFogColor: { value: new THREE.Color('#101a2e') },
      uWind: { value: new THREE.Vector2(0.004, 0.0015) },
    },
    transparent: true,
    side: THREE.BackSide,
    fog: false,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 1; // after near-camera particles, before nothing (it is the sky)
  mesh.frustumCulled = false;
  return mesh;
}

/** Push sun/weather state into the cloud uniforms (`uTime` advances per frame). */
export function updateCloudDome(mesh: THREE.Mesh, state: CloudState): void {
  const mat = mesh.material as THREE.ShaderMaterial;
  const u = mat.uniforms as Record<string, { value: unknown }>;
  (u.uSunDir.value as THREE.Vector3).set(state.sunDirection[0], state.sunDirection[1], state.sunDirection[2]);
  (u.uBaseColor.value as THREE.Color).set(state.baseColor);
  (u.uDarkColor.value as THREE.Color).set(state.darkColor);
  (u.uFogColor.value as THREE.Color).set(state.fog);
  (u.uNightFactor.value as number) = state.nightFactor;
  (u.uCoverage.value as number) = state.coverage;
  (u.uOpacity.value as number) = state.opacity;
  (u.uSilver.value as number) = state.silver;
  (u.uWarmth.value as number) = state.warmth;
  (u.uWind.value as THREE.Vector2).set(state.wind[0], state.wind[1]);
}

/** Advance the drift clock (call once per frame with a seconds clock). */
export function tickCloudDome(mesh: THREE.Mesh, timeSeconds: number): void {
  const mat = mesh.material as THREE.ShaderMaterial;
  (mat.uniforms.uTime.value as number) = timeSeconds;
}
