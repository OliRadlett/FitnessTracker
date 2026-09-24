/**
 * Bike rig for the Relive 3D viewer (Phase 0).
 *
 * Loads the optimized Cube Agree C62 GLB once (meshopt-compressed + WebP — see
 * `scripts/optimize-bike.mjs`), then hands out independent rigs: a container
 * whose local frame is **forward +X, right +Y, up +Z** (the replay world uses
 * ground = XY, altitude = Z). `orientBike` drives heading + lean; the wheel
 * discs are a procedural motion-blur that fades in with speed.
 *
 * Model measurements (metres, model space: nose +Z, up +Y, width ±X):
 *   wheelbase 0.999 · wheel radius 0.336 · front hub z=+0.567 · rear hub z=-0.432
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

export const BIKE_MODEL_URL = '/models/cube-agree-c62-2026.glb';

/** ground-plane up in the replay frame (x=lng, y=lat, z=altitude) */
export const UP_Z = new THREE.Vector3(0, 0, 1);

export const WHEEL_RADIUS = 0.336;
export const WHEEL_HUB_Y = 0.341; // contact 0.005 + radius
export const FRONT_WHEEL_Z = 0.567;
export const REAR_WHEEL_Z = -0.432;

/** max lean into a corner (~24°) */
export const MAX_LEAN = 0.42;

/**
 * Rotation mapping the GLB's local axes into the rig frame:
 * model +X (width) → rig +Y, model +Y (up) → rig +Z, model +Z (nose) → rig +X.
 * Pure — unit-tested.
 */
export function bikeOrientationMatrix(): THREE.Matrix4 {
  return new THREE.Matrix4().makeBasis(
    new THREE.Vector3(0, 1, 0), // image of model X
    new THREE.Vector3(0, 0, 1), // image of model Y
    new THREE.Vector3(1, 0, 0) // image of model Z
  );
}

/**
 * Lean angle (radians) from a turn's horizontal radius and speed:
 * real cyclists bank so that tan(θ) = v·ω / g. Clamped to ±MAX_LEAN. Pure.
 */
export function leanFromCurvature(speedMs: number, yawRateRadPerS: number): number {
  if (!Number.isFinite(speedMs) || !Number.isFinite(yawRateRadPerS)) return 0;
  const raw = Math.atan((speedMs * yawRateRadPerS) / 9.81);
  return Math.max(-MAX_LEAN, Math.min(MAX_LEAN, raw));
}

const _f = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _basis = new THREE.Matrix4();

/**
 * Quaternion orienting a rig so its local +X points along `forward` (a
 * world-space direction, grade included) with ground-plane +Z up, rolled by
 * `leanRad` about the travel axis (positive = lean left, i.e. into a
 * heading-increasing turn). Pure (three math only) — unit-tested.
 */
export function bikePoseQuaternion(forward: THREE.Vector3, leanRad = 0): THREE.Quaternion {
  _f.copy(forward);
  if (_f.lengthSq() < 1e-12) _f.set(1, 0, 0);
  _f.normalize();

  // Right-handed basis X=forward, Y=left, Z=up (Y = Z × X). For the world
  // frame X=lng(east)/Y=lat(north)/Z=up, +Y is the rider's left when facing +X.
  _right.crossVectors(UP_Z, _f);
  if (_right.lengthSq() < 1e-9) _right.set(0, 1, 0); // forward ∥ up (degenerate)
  _right.normalize();
  _up.crossVectors(_f, _right).normalize();

  _basis.makeBasis(_f, _right, _up);
  const q = new THREE.Quaternion().setFromRotationMatrix(_basis);
  // Rolling about the forward axis by +θ tips "up" toward -Y (the rider's
  // right), so negate to make a positive lean tip left (into a left turn).
  if (leanRad) q.premultiply(new THREE.Quaternion().setFromAxisAngle(_f, -leanRad));
  return q;
}

/** Set an object's orientation (convenience wrapper over `bikePoseQuaternion`). */
export function orientBike(object: THREE.Object3D, forward: THREE.Vector3, leanRad = 0): void {
  object.quaternion.copy(bikePoseQuaternion(forward, leanRad));
}

/** radial spoke-blur sprite used as the spinning-wheel overlay */
function createWheelBlurTexture(): THREE.Texture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const c = size / 2;
    // faint radial spokes
    ctx.lineCap = 'round';
    for (let i = 0; i < 44; i++) {
      const a = (i / 44) * Math.PI * 2;
      ctx.strokeStyle = `rgba(214,221,232,${i % 2 ? 0.06 : 0.1})`;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(c + Math.cos(a) * c * 0.16, c + Math.sin(a) * c * 0.16);
      ctx.lineTo(c + Math.cos(a) * c * 0.96, c + Math.sin(a) * c * 0.96);
      ctx.stroke();
    }
    // radial alpha profile: transparent hub, strongest mid-disc, soft rim
    const grad = ctx.createRadialGradient(c, c, 0, c, c, c);
    grad.addColorStop(0.0, 'rgba(226,232,240,0)');
    grad.addColorStop(0.2, 'rgba(226,232,240,0.10)');
    grad.addColorStop(0.55, 'rgba(226,232,240,0.34)');
    grad.addColorStop(0.85, 'rgba(226,232,240,0.22)');
    grad.addColorStop(1.0, 'rgba(226,232,240,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(c, c, c, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.center.set(0.5, 0.5);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export interface BikeRig {
  object: THREE.Group;
  /** spin the wheel blur + fade it in by speed */
  update(speedMs: number, dt: number): void;
  /** heading + lean (dt smooths the pose; omit to snap) */
  setPose(forward: THREE.Vector3, leanRad: number, dt?: number): void;
  dispose(): void;
}

interface Template {
  scene: THREE.Group;
  dispose: () => void;
}

let _template: Promise<Template> | null = null;

/** Load + decode the GLB once; subsequent rigs clone the cached template. */
function loadTemplate(): Promise<Template> {
  if (_template) return _template;
  _template = new Promise<Template>((resolve, reject) => {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    loader.load(
      BIKE_MODEL_URL,
      (gltf) => resolve({ scene: gltf.scene, dispose: () => {} }),
      undefined,
      (err) => {
        _template = null; // allow retry
        reject(err);
      }
    );
  });
  return _template;
}

/**
 * Create a bike rig. `ghost` renders a translucent blue-tinted copy for ghost
 * racing (Phase 5).
 */
export async function createBikeRig({ ghost = false }: { ghost?: boolean } = {}): Promise<BikeRig> {
  const template = await loadTemplate();

  const object = new THREE.Group();
  object.name = ghost ? 'bike-ghost' : 'bike';

  const inner = new THREE.Group();
  inner.quaternion.setFromRotationMatrix(bikeOrientationMatrix());
  const model = template.scene.clone(true);

  if (ghost) {
    model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      mesh.material = mats.map((m) => {
        const clone = m.clone();
        const std = clone as THREE.MeshStandardMaterial;
        if ('color' in std) std.color = std.color.clone().lerp(new THREE.Color(0x60a5fa), 0.55);
        clone.transparent = true;
        clone.opacity = 0.45;
        clone.depthWrite = false;
        return clone;
      }) as unknown as THREE.Material;
    });
  }
  inner.add(model);
  object.add(inner);

  // ── wheel motion-blur discs (rig frame: forward +X, up +Z) ──────────────
  const blurTexture = createWheelBlurTexture();
  const blurMaterial = new THREE.MeshBasicMaterial({
    map: blurTexture,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const discGeo = new THREE.CircleGeometry(WHEEL_RADIUS * 0.98, 48);
  const wheels: THREE.Mesh[] = [];
  for (const x of [FRONT_WHEEL_Z, REAR_WHEEL_Z]) {
    const disc = new THREE.Mesh(discGeo, blurMaterial);
    disc.position.set(x, 0, WHEEL_HUB_Y);
    disc.rotation.x = Math.PI / 2; // normal → rig ±Y (the spin axis)
    disc.renderOrder = 2;
    object.add(disc);
    wheels.push(disc);
  }

  let wheelAngle = 0;

  return {
    object,
    setPose(forward, leanRad, dt) {
      const target = bikePoseQuaternion(forward, leanRad);
      if (dt && dt > 0) object.quaternion.slerp(target, 1 - Math.exp(-dt * 10));
      else object.quaternion.copy(target);
    },
    update(speedMs, dt) {
      // fade the blur in from ~2 m/s to ~7 m/s
      const target = Math.max(0, Math.min(1, (speedMs - 2) / 5)) * 0.8;
      blurMaterial.opacity += (target - blurMaterial.opacity) * Math.min(1, dt * 6);
      // spin rate ∝ speed (visual); roll the shared texture so both wheels spin
      wheelAngle += (speedMs / WHEEL_RADIUS) * dt;
      blurTexture.rotation = -wheelAngle % (Math.PI * 2);
      const visible = blurMaterial.opacity > 0.01;
      for (const w of wheels) w.visible = visible;
    },
    dispose() {
      discGeo.dispose();
      blurMaterial.dispose();
      blurTexture.dispose();
    },
  };
}
