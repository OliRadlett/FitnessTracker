import * as THREE from 'three';
import type { Ride } from '../data/ride';
import { headingAt } from '../data/ride';
import type { Google3DWorld } from '../world/google3dWorld';
import { createBikeRig, leanFromCurvature } from './bike';

const EARTH_RADIUS = 6_378_137;

function toEnu(
  lat: number,
  lng: number,
  alt: number,
  originLat: number,
  originLng: number,
  originAlt: number,
): THREE.Vector3 {
  const latRad = (originLat * Math.PI) / 180;
  const x =
    (((lng - originLng) * Math.PI) / 180) *
    EARTH_RADIUS *
    Math.cos(latRad);
  const y = (((lat - originLat) * Math.PI) / 180) * EARTH_RADIUS;
  return new THREE.Vector3(x, y, alt - originAlt);
}

/**
 * Three.js rider overlay on the Google 3D map.
 *
 * The Google 3D camera is opaque, but the values the world sends to it are
 * known (`getCameraPose`). The bike lives in a local ENU frame at the rider;
 * the overlay camera is rebuilt from the same camera pose each frame. The map
 * stays interactive; the canvas is pointer-events: none.
 */
export function mountRiderOverlay(
  world: Google3DWorld,
  ride: Ride,
  riderIndex: () => number,
): void {
  const container = world.map.parentElement;
  if (!container) return;

  let width = container.clientWidth;
  let height = container.clientHeight;
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  const canvas = renderer.domElement;
  canvas.style.position = 'absolute';
  canvas.style.inset = '0';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.pointerEvents = 'none';
  canvas.style.zIndex = '10';
  container.appendChild(canvas);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 20_000);
  camera.up.set(0, 0, 1);

  scene.add(new THREE.AmbientLight(0xffffff, 2.2));
  scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 3);
  sun.position.set(-40, -30, 100);
  scene.add(sun);
  const rim = new THREE.DirectionalLight(0x88bbff, 1.6);
  rim.position.set(60, 50, 20);
  scene.add(rim);

  let rig: Awaited<ReturnType<typeof createBikeRig>> | null = null;
  let last = performance.now();

  createBikeRig()
    .then((loaded) => {
      rig = loaded;
      rig.object.position.set(0, 0, 0);
      scene.add(rig.object);
    })
    .catch((error: unknown) => {
      console.error('[relive] 3D rider failed; falling back to marker', error);
      canvas.remove();
      world.enableRiderMarker(riderIndex());
    });

  const resize = () => {
    width = container.clientWidth;
    height = container.clientHeight;
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize);

  const frame = (now: number) => {
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;

    const i = Math.max(
      0,
      Math.min(ride.streams.lat.length - 1, riderIndex()),
    );
    const originLat = ride.streams.lat[i];
    const originLng = ride.streams.lng[i];
    const originAlt = ride.streams.alt[i];

    const pose = world.getCameraPose();
    const cam = toEnu(
      pose.lat,
      pose.lng,
      pose.alt,
      originLat,
      originLng,
      originAlt,
    );
    camera.position.copy(cam);
    camera.lookAt(0, 0, 0.9);
    camera.fov = pose.fov;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();

    if (rig) {
      const speed = ride.streams.v[i];
      const headingRad = (headingAt(ride, i) * Math.PI) / 180;
      const grade = ride.streams.grade[i] / 100;
      const forward = new THREE.Vector3(
        Math.sin(headingRad),
        Math.cos(headingRad),
        grade,
      ).normalize();

      const i0 = Math.max(0, i - 2);
      const i1 = Math.min(ride.streams.lat.length - 1, i + 2);
      const dtTurn = ride.streams.t[i1] - ride.streams.t[i0];
      const dHeading =
        ((headingAt(ride, i1) - headingAt(ride, i0) + 540) % 360) - 180;
      const yawRate =
        dtTurn > 0 ? ((dHeading * Math.PI) / 180) / dtTurn : 0;
      const lean = leanFromCurvature(speed, yawRate);
      rig.setPose(forward, lean, dt);
      rig.update(speed, dt);
    }

    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
