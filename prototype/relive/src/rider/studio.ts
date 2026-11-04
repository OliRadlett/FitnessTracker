import * as THREE from 'three';
import { createBikeRig, type BikeRig } from './bike';

const root = document.querySelector<HTMLElement>('#studio');
if (root) {
  const width = root.clientWidth;
  const height = root.clientHeight;

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x0a1428, 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  root.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a1428);
  scene.fog = new THREE.Fog(0x101a2e, 26, 60);

  const camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 200);
  camera.up.set(0, 0, 1);

  const presets: Record<string, { pos: [number, number, number]; target: [number, number, number] }> = {
    hero: { pos: [3.6, -2.8, 2.0], target: [0, 0, 0.55] },
    close: { pos: [-6, 0, 2.2], target: [0, 0, 0.9] },
    follow: { pos: [-10, 0, 3.5], target: [0, 0, 0.9] },
    climb: { pos: [-18, 0, 6], target: [0, 0, 0.9] },
    side: { pos: [0, -5.5, 1.6], target: [0, 0, 0.85] },
    front: { pos: [6, 0, 1.6], target: [0, 0, 0.8] },
  };

  const setPreset = (name: string) => {
    const preset = presets[name] ?? presets.hero;
    camera.position.set(...preset.pos);
    camera.lookAt(...preset.target);
    document.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((button) => {
      button.classList.toggle('active', button.dataset.preset === name);
    });
  };
  setPreset('hero');

  const hemi = new THREE.HemisphereLight(0xffffff, 0x2c3e50, 1.2);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(-6, -4, 12);
  scene.add(sun);
  const rim = new THREE.DirectionalLight(0xaad4ff, 0.4);
  rim.position.set(8, 8, 4);
  scene.add(rim);

  const setLighting = (name: string) => {
    if (name === 'relive') {
      scene.background = new THREE.Color(0x0a1428);
      scene.fog = new THREE.Fog(0x101a2e, 26, 60);
      hemi.color.setHex(0x1b2b46);
      hemi.groundColor.setHex(0x0a0f1a);
      hemi.intensity = 0.9;
      sun.color.setHex(0xfff2df);
      sun.intensity = 1.4;
      rim.intensity = 0;
      renderer.toneMappingExposure = 1.0;
    } else if (name === 'studio') {
      scene.background = new THREE.Color(0x101a2a);
      scene.fog = new THREE.Fog(0x101a2a, 26, 60);
      hemi.color.setHex(0xffffff);
      hemi.groundColor.setHex(0x223344);
      hemi.intensity = 1.5;
      sun.color.setHex(0xffffff);
      sun.intensity = 2.8;
      rim.intensity = 1.2;
      renderer.toneMappingExposure = 1.05;
    } else {
      scene.background = new THREE.Color(0x8fa9c2);
      scene.fog = new THREE.Fog(0x8fa9c2, 26, 60);
      hemi.color.setHex(0xffffff);
      hemi.groundColor.setHex(0x2c3e50);
      hemi.intensity = 1.2;
      sun.color.setHex(0xffffff);
      sun.intensity = 2.2;
      rim.intensity = 0.4;
      renderer.toneMappingExposure = 1.0;
    }
  };
  setLighting('daylight');

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(120, 120),
    new THREE.MeshStandardMaterial({
      color: 0x4d5e70,
      roughness: 0.96,
      metalness: 0.04,
    }),
  );
  scene.add(ground);

  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(60, 7),
    new THREE.MeshStandardMaterial({
      color: 0x2b3542,
      roughness: 0.82,
      metalness: 0.08,
    }),
  );
  road.position.z = 0.004;
  scene.add(road);

  const laneMaterial = new THREE.MeshBasicMaterial({ color: 0xd7dee8 });
  for (let x = -28; x < 28; x += 4) {
    const dash = new THREE.Mesh(new THREE.PlaneGeometry(2, 0.12), laneMaterial);
    dash.position.set(x, 0, 0.008);
    scene.add(dash);
  }

  const shadowCanvas = document.createElement('canvas');
  shadowCanvas.width = 128;
  shadowCanvas.height = 128;
  const shadowCtx = shadowCanvas.getContext('2d');
  if (shadowCtx) {
    const g = shadowCtx.createRadialGradient(64, 64, 4, 64, 64, 62);
    g.addColorStop(0, 'rgba(0,0,0,0.55)');
    g.addColorStop(0.55, 'rgba(0,0,0,0.22)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    shadowCtx.fillStyle = g;
    shadowCtx.fillRect(0, 0, 128, 128);
  }
  const shadowTexture = new THREE.CanvasTexture(shadowCanvas);
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(2.6, 3.6),
    new THREE.MeshBasicMaterial({
      map: shadowTexture,
      transparent: true,
      depthWrite: false,
    }),
  );
  shadow.position.set(0, 0, 0.01);
  scene.add(shadow);

  let speed = 8;
  let lean = 0.08;
  let ghostVisible = false;
  let mainRig: BikeRig | null = null;
  let ghostRig: BikeRig | null = null;
  let last = performance.now();

  const forward = new THREE.Vector3(1, 0, 0);

  createBikeRig()
    .then((rig) => {
      mainRig = rig;
      rig.object.position.set(0, 0, 0);
      scene.add(rig.object);
      rig.setPose(forward, lean);
      rig.update(speed, 0.016);
    })
    .catch((error: unknown) => {
      console.error('[relive] studio bike failed', error);
    });

  createBikeRig({ ghost: true })
    .then((rig) => {
      ghostRig = rig;
      rig.object.position.set(-2.6, 0, 0);
      rig.object.visible = false;
      scene.add(rig.object);
      rig.setPose(forward, lean);
      rig.update(speed, 0.016);
    })
    .catch((error: unknown) => {
      console.error('[relive] studio ghost failed', error);
    });

  document.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((button) => {
    button.addEventListener('click', () => setPreset(button.dataset.preset ?? 'hero'));
  });

  const speedInput = document.querySelector<HTMLInputElement>('#speed');
  const leanInput = document.querySelector<HTMLInputElement>('#lean');
  const ghostInput = document.querySelector<HTMLInputElement>('#ghost');
  speedInput?.addEventListener('input', () => {
    speed = Number(speedInput.value);
    const label = document.querySelector<HTMLElement>('#speed-value');
    if (label) label.textContent = `${speed.toFixed(1)} m/s`;
  });
  leanInput?.addEventListener('input', () => {
    lean = Number(leanInput.value);
    const label = document.querySelector<HTMLElement>('#lean-value');
    if (label) label.textContent = `${(lean * 57.3).toFixed(0)}°`;
  });
  ghostInput?.addEventListener('change', () => {
    ghostVisible = Boolean(ghostInput.checked);
    if (ghostRig) ghostRig.object.visible = ghostVisible;
  });

  const lightingInput = document.querySelector<HTMLSelectElement>('#lighting');
  lightingInput?.addEventListener('change', () => {
    setLighting(lightingInput.value);
  });

  const frame = (now: number) => {
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    if (mainRig) {
      mainRig.setPose(forward, lean, dt);
      mainRig.update(speed, dt);
    }
    if (ghostRig) {
      ghostRig.setPose(forward, lean, dt);
      ghostRig.update(speed, dt);
    }
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
