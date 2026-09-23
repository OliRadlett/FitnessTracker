'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { POSE_CONNECTIONS, type PoseTrack, frameIndexAt } from '@/lib/pose/track';

interface Pose3DProps {
  videoRef: React.RefObject<HTMLVideoElement>;
  track: PoseTrack;
}

// MediaPipe world landmarks are hip-origin with +y down; flip y so up is +y and
// lift the hips to ~0.9 m so the feet sit on the ground grid.
const HIP_LIFT = 0.9;

/**
 * three.js 3D skeleton driven by the persisted metric world landmarks, synced
 * to the video playhead. Rendered as a small picture-in-picture panel so the
 * video's own controls stay usable. Lazy-loaded (three stays out of the
 * first-load bundle). Orbit/zoom with the mouse.
 */
export default function Pose3D({ videoRef, track }: Pose3DProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const mount = mountRef.current;
    const video = videoRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b1220);

    const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 100);
    camera.position.set(1.6, 1.1, 1.6);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, HIP_LIFT, 0);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.minDistance = 1.2;
    controls.maxDistance = 6;

    const grid = new THREE.GridHelper(4, 8, 0x334155, 0x1e293b);
    grid.position.y = 0; // feet level (hips lifted by HIP_LIFT)
    scene.add(grid);

    const bonePositions = new Float32Array(POSE_CONNECTIONS.length * 2 * 3);
    const boneGeom = new THREE.BufferGeometry();
    boneGeom.setAttribute('position', new THREE.BufferAttribute(bonePositions, 3));
    const boneMat = new THREE.LineBasicMaterial({ color: 0x38bdf8 });
    const bones = new THREE.LineSegments(boneGeom, boneMat);
    scene.add(bones);

    const jointPositions = new Float32Array(33 * 3);
    const jointGeom = new THREE.BufferGeometry();
    jointGeom.setAttribute('position', new THREE.BufferAttribute(jointPositions, 3));
    const jointMat = new THREE.PointsMaterial({ color: 0xe2e8f0, size: 0.035 });
    const joints = new THREE.Points(jointGeom, jointMat);
    scene.add(joints);

    const toScene = (p: [number, number, number], out: Float32Array, o: number) => {
      out[o] = p[0];
      out[o + 1] = -p[1] + HIP_LIFT;
      out[o + 2] = p[2];
    };

    const resize = () => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(mount);
    resize();

    const draw = () => {
      const idx = video ? frameIndexAt(track, video.currentTime) : 0;
      const w = idx >= 0 ? track.frames[idx]?.w : null;
      if (w && w.length >= 33) {
        for (let c = 0; c < POSE_CONNECTIONS.length; c++) {
          const [a, b] = POSE_CONNECTIONS[c];
          toScene(w[a], bonePositions, c * 6);
          toScene(w[b], bonePositions, c * 6 + 3);
        }
        boneGeom.attributes.position.needsUpdate = true;
        for (let i = 0; i < 33; i++) toScene(w[i], jointPositions, i * 3);
        jointGeom.attributes.position.needsUpdate = true;
        bones.visible = true;
        joints.visible = true;
      } else {
        bones.visible = false;
        joints.visible = false;
      }
      controls.update();
      renderer.render(scene, camera);
      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      controls.dispose();
      boneGeom.dispose();
      boneMat.dispose();
      jointGeom.dispose();
      jointMat.dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement === mount) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, [videoRef, track]);

  return <div ref={mountRef} className="h-full w-full" aria-hidden="true" />;
}
