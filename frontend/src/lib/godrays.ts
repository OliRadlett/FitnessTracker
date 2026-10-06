import * as THREE from 'three';

/**
 * Crepuscular god-rays for the Relive viewer (next-level Phase A).
 *
 * A single fullscreen ShaderPass chained between the render and bloom passes:
 * it gathers luminance above a threshold toward the sun's screen position
 * (classic GPU-Gems-style radial blur) and adds the shafts back onto the
 * scene, so they bloom with everything else. Deliberately depth-free — the
 * renderer uses `logarithmicDepthBuffer`, which is exactly what killed
 * BokehPass, so no pass here may assume perspective depth.
 *
 * Failure mode is gentle by construction: sun off-screen or behind the camera
 * fades the effect to zero instead of smearing the frame.
 */

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const sstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

export interface SunScreen {
  /** sun position in 0..1 screen space (garbage when invisible — check first) */
  uv: [number, number];
  /** 0 (behind camera / far off-screen) → 1 (framed) */
  visible: number;
}

/**
 * Project the sun direction to screen space. Pure three.js math (no DOM or
 * GL context), so it is unit-testable with a synthetic camera.
 */
export function sunScreenPosition(
  camera: THREE.PerspectiveCamera,
  sunDir: [number, number, number]
): SunScreen {
  camera.updateMatrixWorld();
  const sun = new THREE.Vector3(sunDir[0], sunDir[1], sunDir[2]).normalize();
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  const facing = forward.dot(sun);
  const p = camera.position.clone().addScaledVector(sun, camera.far * 0.5);
  p.project(camera);
  const uv: [number, number] = [(p.x + 1) / 2, (p.y + 1) / 2];
  // Fade before the sun leaves the frame so shafts never streak in from a
  // mirrored off-screen projection (project() flips when behind the camera,
  // but `facing` already zeroes that case).
  const m = Math.max(Math.abs(uv[0] - 0.5), Math.abs(uv[1] - 0.5)) * 2;
  const edgeFade = 1 - sstep(0.7, 1.3, m);
  const behindFade = sstep(-0.05, 0.15, facing);
  return { uv, visible: clamp01(behindFade * edgeFade) };
}

export interface GodRaysTuning {
  /** shaft strength once framed (conservative — shafts bloom on top) */
  exposure: number;
  /** radial sample spread; higher = longer shafts */
  density: number;
  /** per-step decay along each ray */
  decay: number;
  /** linear-HDR luminance floor feeding the gather */
  threshold: number;
}

/** Shipped defaults: visible at golden hour, restrained at noon. */
export const GOD_RAYS_DEFAULTS: GodRaysTuning = {
  exposure: 0.32,
  density: 0.9,
  decay: 0.96,
  threshold: 0.85,
};

const GOD_RAYS_FRAG = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform vec2 uSunUv;
uniform float uIntensity;
uniform float uDensity;
uniform float uDecay;
uniform float uThreshold;
uniform float uExposure;
#define GOD_RAY_SAMPLES 48
void main() {
  vec3 base = texture2D(tDiffuse, vUv).rgb;
  vec2 delta = (vUv - uSunUv) * (uDensity / float(GOD_RAY_SAMPLES));
  vec2 uv = vUv;
  float decay = 1.0;
  vec3 shafts = vec3(0.0);
  for (int i = 0; i < GOD_RAY_SAMPLES; i++) {
    uv -= delta;
    vec3 s = texture2D(tDiffuse, uv).rgb;
    float lum = dot(s, vec3(0.299, 0.587, 0.114));
    shafts += max(lum - uThreshold, 0.0) * decay;
    decay *= uDecay;
  }
  shafts /= float(GOD_RAY_SAMPLES);
  vec3 col = base + shafts * uExposure * uIntensity;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const GOD_RAYS_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/** ShaderPass-compatible definition (screen-space UV quad). */
export const GodRaysShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uSunUv: { value: new THREE.Vector2(0.5, 0.5) },
    uIntensity: { value: 0 },
    uDensity: { value: GOD_RAYS_DEFAULTS.density },
    uDecay: { value: GOD_RAYS_DEFAULTS.decay },
    uThreshold: { value: GOD_RAYS_DEFAULTS.threshold },
    uExposure: { value: GOD_RAYS_DEFAULTS.exposure },
  },
  vertexShader: GOD_RAYS_VERT,
  fragmentShader: GOD_RAYS_FRAG,
};
