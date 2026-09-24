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
