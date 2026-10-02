import * as THREE from 'three';

/**
 * Vertical-gradient sky dome that always surrounds the camera (styled dark).
 * Shared by the ride replay and the 3D route view. Follow the camera each frame
 * (`sky.position.copy(camera.position)`).
 */
export function createSkyDome(radius: number, top: THREE.Color, bottom: THREE.Color): THREE.Mesh {
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

/** styled dark-world sky palette (replay + route view) */
export const SKY_TOP = new THREE.Color('#0a1428');
export const SKY_HORIZON = new THREE.Color('#1b2b46');
export const FOG_COLOR = new THREE.Color('#101a2e');

export interface AtmosphereWeather {
  overcast: boolean;
  rainy: boolean;
  snowy: boolean;
  foggy: boolean;
}

export interface AtmosphereFactors {
  /** 0 in daylight → 1 in full night (drives stars + sun fade) */
  nightFactor: number;
  /** 0 clear → ~0.8 heavy rain (drives the grey-out) */
  greyFactor: number;
  /** sun disc/glow strength after night + weather attenuation */
  sunGlow: number;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/**
 * Pure mapping from solar elevation + weather to atmosphere uniforms.
 * Non-finite elevation (Invalid Date upstream) reads as full night.
 */
export function atmosphereFactors(
  elevationDeg: number,
  weather: AtmosphereWeather | null
): AtmosphereFactors {
  const e = Number.isFinite(elevationDeg) ? elevationDeg : -18;
  const nightFactor = 1 - smoothstep(-8, -2, e);
  let greyFactor = 0;
  if (weather) {
    if (weather.overcast) greyFactor = Math.max(greyFactor, 0.55);
    if (weather.foggy) greyFactor = Math.max(greyFactor, 0.55);
    if (weather.snowy) greyFactor = Math.max(greyFactor, 0.7);
    if (weather.rainy) greyFactor = Math.max(greyFactor, 0.8);
  }
  const dayAmount = smoothstep(-2, 2, e); // twilight keeps a fading glow
  const sunGlow = dayAmount * (1 - nightFactor * 0.85) * (1 - greyFactor * 0.7);
  return { nightFactor, greyFactor, sunGlow };
}

export interface AtmosphereState {
  sunDirection: [number, number, number];
  /** css colour strings (sun-model palette — the time scrubber owns these) */
  skyTop: string;
  skyHorizon: string;
  fog: string;
  nightFactor: number;
  greyFactor: number;
  sunGlow: number;
}

const ATMOSPHERE_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const ATMOSPHERE_FRAG = /* glsl */ `
varying vec3 vDir;
uniform vec3 uSunDir;
uniform vec3 uTopColor;
uniform vec3 uHorizonColor;
uniform vec3 uFogColor;
uniform float uNightFactor;
uniform float uGreyFactor;
uniform float uSunGlow;

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

void main() {
  vec3 dir = normalize(vDir);
  float h = dir.y;
  vec3 sky = mix(uHorizonColor, uTopColor, pow(clamp(h, 0.0, 1.0), 0.55));
  vec3 ground = mix(uHorizonColor, uFogColor, clamp(-h * 4.0, 0.0, 1.0));
  vec3 col = h >= 0.0 ? sky : ground;
  // Sun disc + warm glow (tints orange as the sun drops).
  float cosAng = dot(dir, uSunDir);
  float disc = smoothstep(0.99988, 0.99996, cosAng);
  float glow = pow(max(cosAng, 0.0), 600.0) * 1.2 + pow(max(cosAng, 0.0), 10.0) * 0.22;
  vec3 sunTint = mix(vec3(1.0, 0.95, 0.88), vec3(1.0, 0.55, 0.25), clamp(1.0 - uSunDir.y * 3.0, 0.0, 1.0));
  col += sunTint * (disc * 2.0 + glow) * uSunGlow;
  // Weather grey-out: desaturate toward a cool grey.
  float lum = dot(col, vec3(0.333));
  col = mix(col, vec3(lum) * vec3(0.95, 0.98, 1.05) + vec3(0.03), uGreyFactor * 0.75);
  // Night stars above the horizon (static — twinkle would alias in motion).
  if (uNightFactor > 0.01 && h > 0.0) {
    vec3 cell = floor(dir * 220.0);
    float star = step(0.9975, hash13(cell));
    float bright = 0.75 + 0.25 * hash13(cell + 7.7);
    col += vec3(0.9, 0.95, 1.0) * star * bright * uNightFactor * smoothstep(0.0, 0.25, h);
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/**
 * Analytic atmosphere dome (next-level Phase A): sun disc + glow, night
 * stars, weather grey-out and below-horizon fog dissolve, all driven by the
 * existing sun-model palette so the time-of-day scrubber keeps working —
 * scrubbing now updates uniforms instead of regenerating a canvas texture.
 * Same contract as `createSkyDome` (follows the camera, renders behind
 * everything); the route view keeps the gradient dome for now.
 */
export function createAtmosphereDome(radius: number): THREE.Mesh {
  const geo = new THREE.SphereGeometry(radius, 32, 16);
  const mat = new THREE.ShaderMaterial({
    vertexShader: ATMOSPHERE_VERT,
    fragmentShader: ATMOSPHERE_FRAG,
    uniforms: {
      uSunDir: { value: new THREE.Vector3(0.5, -0.5, 0.8) },
      uTopColor: { value: new THREE.Color('#0a1428') },
      uHorizonColor: { value: new THREE.Color('#1b2b46') },
      uFogColor: { value: new THREE.Color('#101a2e') },
      uNightFactor: { value: 0 },
      uGreyFactor: { value: 0 },
      uSunGlow: { value: 1 },
    },
    side: THREE.BackSide,
    fog: false,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = -1;
  mesh.frustumCulled = false;
  return mesh;
}

/** Push a sun-model state into the dome's uniforms (no texture rebuilds). */
export function updateAtmosphereDome(mesh: THREE.Mesh, state: AtmosphereState): void {
  const mat = mesh.material as THREE.ShaderMaterial;
  const u = mat.uniforms as Record<string, { value: unknown }>;
  (u.uSunDir.value as THREE.Vector3).set(state.sunDirection[0], state.sunDirection[1], state.sunDirection[2]);
  (u.uTopColor.value as THREE.Color).set(state.skyTop);
  (u.uHorizonColor.value as THREE.Color).set(state.skyHorizon);
  (u.uFogColor.value as THREE.Color).set(state.fog);
  (u.uNightFactor.value as number) = state.nightFactor;
  (u.uGreyFactor.value as number) = state.greyFactor;
  (u.uSunGlow.value as number) = state.sunGlow;
}
