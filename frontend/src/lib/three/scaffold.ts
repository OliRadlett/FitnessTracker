/**
 * three.js scene scaffold for the Relive 3D viewer (extracted from Replay3D).
 *
 * Renderer / post-chain creation plus the resolution-sync helper that keeps
 * renderer, composer and fat-line materials in step. Ride-specific content
 * (path, road, bike, markers, tick) stays in the component.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import type { LineMaterial } from 'three/addons/lines/LineMaterial.js';

/** Create the WebGL renderer, or null when WebGL is unavailable. */
export function createRenderer(mount: HTMLElement, liteMode: boolean): THREE.WebGLRenderer | null {
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
    return null;
  }
  renderer.setPixelRatio(liteMode ? 1 : Math.min(window.devicePixelRatio, 2));
  renderer.setSize(mount.clientWidth, mount.clientHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = !liteMode;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  return renderer;
}

export interface PostChain {
  composer: EffectComposer | null;
  dofPass: BokehPass | null;
}

/**
 * Depth-of-field → bloom → output chain (skipped in Lite mode).
 * DOF focus tracks the rider per-frame in the tick; aperture by camera mode.
 */
export function createPostChain(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  mount: HTMLElement,
  liteMode: boolean,
): PostChain {
  if (liteMode) return { composer: null, dofPass: null };
  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  composer.setSize(mount.clientWidth, mount.clientHeight);
  composer.addPass(new RenderPass(scene, camera));
  const dofPass = new BokehPass(scene, camera, { focus: 50, aperture: 0.0012, maxblur: 0.008 });
  composer.addPass(dofPass);
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(mount.clientWidth, mount.clientHeight), 0.6, 0.5, 0.8));
  composer.addPass(new OutputPass());
  return { composer, dofPass };
}

export interface ResizeScaffoldArgs {
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  composer: EffectComposer | null;
  /** fat-line materials whose resolution must track the drawing buffer */
  lineMats: (LineMaterial | null | undefined)[];
  w: number;
  h: number;
  /** pass false for offscreen renders (poster) that must not touch CSS layout */
  updateStyle?: boolean;
  /** 2 for the 2x poster render, 1 normally */
  resScale?: number;
}

/**
 * Keep renderer size, camera aspect, composer size and LineMaterial
 * resolutions in sync. Line2 widths are resolution-dependent — every material
 * (path + trail + race traces) must be updated together.
 */
export function resizeScaffold({
  renderer,
  camera,
  composer,
  lineMats,
  w,
  h,
  updateStyle = true,
  resScale = 1,
}: ResizeScaffoldArgs): void {
  renderer.setSize(w, h, updateStyle);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  composer?.setSize(w, h);
  for (const m of lineMats) m?.resolution.set(w * resScale, h * resScale);
}
