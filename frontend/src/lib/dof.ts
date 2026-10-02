import * as THREE from 'three';
import type { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import type { ReplayCamMode } from './director';

/**
 * Depth-of-field for the Relive viewer (next-level Phase A).
 *
 * Why this exists: BokehPass was rejected because it decodes its depth
 * prepass with perspective math while the renderer uses
 * `logarithmicDepthBuffer`. This pass sidesteps that trap entirely — the
 * depth prepass renders with `MeshDepthMaterial` + RGBA packing, which packs
 * **clip-space** depth (`vHighPrecisionZW`, derived from `gl_Position`).
 * Logarithmic depth only alters `gl_FragDepth` writes, never `gl_Position`,
 * so the packed texture is perspective depth under either setting and the
 * standard `perspectiveDepthToViewZ` unpack is correct.
 *
 * Safety: the whole feature ships behind a default-OFF toolbar toggle. With
 * the toggle off no prepass runs and the composer chain is byte-identical to
 * before, so an unaudited aesthetic can never blur a real session.
 */

export interface DofSettings {
  /** world units from the focus plane to full blur */
  range: number;
  /** blur radius in depth-texture pixels at full CoC */
  maxBlur: number;
}

/**
 * Focus policy per resolved camera mode. Orbit/cinematic go shallow and
 * dramatic; follow cams (and tour shots, which frame tight action) stay deep
 * so the road ahead stays readable; the cockpit (camera inside the bike)
 * stays fully sharp.
 */
export function dofSettingsFor(mode: ReplayCamMode): DofSettings | null {
  if (mode === 'auto' || mode === 'cockpit') return null;
  if (mode === 'orbit' || mode === 'cinematic') return { range: 30, maxBlur: 6 };
  return { range: 400, maxBlur: 1.5 };
}

const DOF_FRAG = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform sampler2D tDepth;
uniform float uFocus;
uniform float uRange;
uniform float uMaxBlur;
uniform vec2 uResolution;
uniform float uNear;
uniform float uFar;
#include <packing>
void main() {
  float depth = unpackRGBAToDepth(texture2D(tDepth, vUv));
  float viewZ = perspectiveDepthToViewZ(depth, uNear, uFar);
  float coc = clamp(abs(viewZ - uFocus) / uRange, 0.0, 1.0);
  vec3 acc = texture2D(tDiffuse, vUv).rgb;
  if (coc > 0.003) {
    vec2 px = (uMaxBlur * coc) / uResolution;
    vec2 taps[12];
    taps[0] = vec2(-0.94, -0.40);
    taps[1] = vec2(0.94, 0.40);
    taps[2] = vec2(-0.40, 0.94);
    taps[3] = vec2(0.40, -0.94);
    taps[4] = vec2(-0.70, -0.70);
    taps[5] = vec2(0.70, 0.70);
    taps[6] = vec2(-0.70, 0.70);
    taps[7] = vec2(0.70, -0.70);
    taps[8] = vec2(-1.00, 0.00);
    taps[9] = vec2(1.00, 0.00);
    taps[10] = vec2(0.00, -1.00);
    taps[11] = vec2(0.00, 1.00);
    for (int i = 0; i < 12; i++) {
      acc += texture2D(tDiffuse, vUv + taps[i] * px).rgb;
    }
    acc /= 13.0;
  }
  gl_FragColor = vec4(acc, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const DOF_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/** Owned DOF resources: the composer never sees the depth target. */
export interface DofTarget {
  pass: ShaderPass;
  rt: THREE.WebGLRenderTarget;
}

/**
 * Resize the half-res depth target + its resolution uniform after any composer
 * resize (window, perf degrade, 2× poster capture). Stale sizes silently
 * rescale the blur radius, so every resize path must call this.
 */
export function syncDofTarget(
  dof: DofTarget,
  fullW: number,
  fullH: number,
  pixelRatio: number
): void {
  dof.rt.setSize(
    Math.max(2, Math.floor((fullW * pixelRatio) / 2)),
    Math.max(2, Math.floor((fullH * pixelRatio) / 2))
  );
  (dof.pass.uniforms.uResolution.value as THREE.Vector2).set(dof.rt.width, dof.rt.height);
}

/** ShaderPass-compatible definition (screen-space UV quad). */
export const DofShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tDepth: { value: null as THREE.Texture | null },
    uFocus: { value: 10 },
    uRange: { value: 30 },
    uMaxBlur: { value: 6 },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uNear: { value: 0.3 },
    uFar: { value: 8000 },
  },
  vertexShader: DOF_VERT,
  fragmentShader: DOF_FRAG,
};
