import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import { MapLibreWorld } from './world/maplibreWorld';
import type { World } from './world/World';
import { createUI } from './ui/overlay';
import {
  POSES,
  RIDES,
  GHOST_RIDES,
  ROUTE_HISTORY,
  formatDate,
  formatShortDate,
  indexAtTime,
  poseTime,
  type PoseName,
  type Ride,
} from './data/ride';

const params = new URLSearchParams(window.location.search);
const freeze = params.get('freeze') === '1';
const hideUI = params.get('ui') === '0';
const rider3d = params.get('rider') === '3d';
const seekMode: 'rider' | 'focus' | 'none' =
  params.get('sync') === '0' ? 'none' : 'focus';
if (hideUI) document.body.classList.add('no-ui');

const rideId = params.get('ride') ?? 'lake';
const ride: Ride = RIDES[rideId] ?? RIDES.lake;
const routeHistory = ROUTE_HISTORY[rideId];
const pbId = routeHistory?.personal_best?.activity_id ?? null;
const sameLapRides = (routeHistory?.rides ?? []).filter(
  (r) =>
    r.activity_id !== ride.activityId &&
    Math.abs((r.distance_meters ?? 0) - ride.stats.distanceM) < 1000,
);
const ghostRides: Ride[] = sameLapRides
  .map((r) =>
    (GHOST_RIDES[rideId] ?? []).find((g) => g.activityId === r.activity_id),
  )
  .filter((g): g is Ride => Boolean(g));
let ghostRide: Ride | undefined = ghostRides[0];
const ghostOptions = ghostRides.map((g) => {
  const historyRide = sameLapRides.find(
    (r) => r.activity_id === g.activityId,
  );
  const pb = historyRide?.activity_id === pbId ? ' · PB' : '';
  return { id: g.id, label: `${formatDate(g.date)}${pb}` };
});
const T0 = ride.streams.t[0];
const T1 = ride.streams.t[ride.streams.t.length - 1];

const validPose = (value: string | null): PoseName => {
  const found = POSES.find((p) => p.id === value);
  return found?.id ?? 'overview';
};

const initialPose = validPose(params.get('pose'));
const initialT = params.has('t')
  ? Number(params.get('t'))
  : poseTime(ride, initialPose);

const mapEl = document.querySelector<HTMLElement>('#map')!;
const uiEl = document.querySelector<HTMLElement>('#ui')!;

const worldName = params.get('world') ?? 'google3d';
let world: World;
if (worldName === 'cesium') {
  const { CesiumWorld } = await import('./world/cesiumWorld');
  world = new CesiumWorld(mapEl, ride);
} else if (worldName === 'google3d') {
  const { Google3DWorld } = await import('./world/google3dWorld');
  world = new Google3DWorld(mapEl, ride, rider3d);
} else {
  world = new MapLibreWorld(mapEl, ride);
}

try {
  await world.mount();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  uiEl.innerHTML = `<div class="fatal"><h1>World failed to load</h1><p>${message}</p><p>Check <code>VITE_GOOGLE_MAPS_API_KEY</code> and that the Map Tiles API is allowed for the key.</p></div>`;
  document.body.dataset.ready = 'error';
  throw error;
}

let t = Math.min(T1, Math.max(T0, Number.isFinite(initialT) ? initialT : T0));
let playing = !freeze;
let speed = 120;
let debugVisible = false;
let follow = false;
let currentPose: PoseName = initialPose;
const GHOST_LEAD_S = 15;
let ghostEnabled = params.get('ghost') === '1';
const ghostIndexAt = (time: number) =>
  indexAtTime(ride, Math.min(T1, time + GHOST_LEAD_S));

const applyTime = (
  next: number,
  mode: 'rider' | 'focus' | 'none' = 'rider',
) => {
  t = Math.min(T1, Math.max(T0, next));
  const index = indexAtTime(ride, t);
  if (mode === 'focus') world.focusRider(index);
  else if (mode === 'rider') world.setRider(index);
  if (ghostEnabled) {
    if (ghostRide) {
      const ghostIndex = indexAtTime(
        ghostRide,
        ghostRide.streams.t[0] + (t - T0),
      );
      world.setGhost({
        lat: ghostRide.streams.lat[ghostIndex],
        lng: ghostRide.streams.lng[ghostIndex],
        alt: ghostRide.streams.alt[ghostIndex],
      });
      ui.setGhost(
        true,
        ghostRide.streams.d[ghostIndex] - ride.streams.d[index],
        ghostRide.id,
        formatShortDate(ghostRide.date),
      );
    } else {
      const ghostIndex = ghostIndexAt(t);
      world.setGhost({
        lat: ride.streams.lat[ghostIndex],
        lng: ride.streams.lng[ghostIndex],
        alt: ride.streams.alt[ghostIndex],
      });
      ui.setGhost(
        true,
        ride.streams.d[ghostIndex] - ride.streams.d[index],
        null,
        null,
      );
    }
  } else {
    world.setGhost(null);
    ui.setGhost(false, 0);
  }
  ui.setTime(t, index);
};

const seekTo = (next: number) => applyTime(next, seekMode);

const setPose = (pose: PoseName, animate: boolean, fromUser = false) => {
  currentPose = pose;
  if (fromUser && follow) {
    follow = false;
    world.setFollow(false);
    ui.setFollow(false);
  }
  world.setPose(pose, animate);
  applyTime(poseTime(ride, pose), 'none');
  ui.setPose(pose);
};

const ui = createUI(uiEl, ride, {
  onPose: (pose) => setPose(pose, true, true),
  onPlayToggle: () => {
    if (!playing && t >= T1) t = T0;
    playing = !playing;
    ui.setPlaying(playing);
  },
  onFollowToggle: () => {
    follow = !follow;
    world.setFollow(follow);
    ui.setFollow(follow);
  },
  onGhostToggle: () => {
    ghostEnabled = !ghostEnabled;
    if (ghostEnabled && !ghostRide && ghostRides.length) {
      ghostRide = ghostRides[0];
    }
    applyTime(t);
  },
  onGhostSelect: (id) => {
    if (id == null) {
      ghostEnabled = false;
      applyTime(t);
      return;
    }
    const selected = ghostRides.find((g) => g.id === id);
    if (!selected) return;
    ghostRide = selected;
    ghostEnabled = true;
    applyTime(t);
  },
  onSeek: (next) => {
    seekTo(next);
  },
  onSpeedChange: (next) => {
    speed = next;
  },
}, ghostOptions);

world.setPose(initialPose, false);
applyTime(t);
ui.setPose(initialPose);
ui.setPlaying(playing);
ui.setFollow(follow);

if (rider3d && worldName === 'google3d') {
  const { mountRiderOverlay } = await import('./rider/overlay');
  mountRiderOverlay(
    world as unknown as import('./world/google3dWorld').Google3DWorld,
    ride,
    () => indexAtTime(ride, t),
  );
}

window.addEventListener('keydown', (event) => {
  if (event.target instanceof HTMLInputElement) return;
  const index = Number(event.key) - 1;
  if (index >= 0 && index < POSES.length) {
    setPose(POSES[index].id, true, true);
    return;
  }
  if (event.key.toLowerCase() === 'p') {
    if (!playing && t >= T1) t = T0;
    playing = !playing;
    ui.setPlaying(playing);
  }
  if (event.key.toLowerCase() === 'f') {
    follow = !follow;
    world.setFollow(follow);
    ui.setFollow(follow);
  }
  if (event.key.toLowerCase() === 'g') {
    ghostEnabled = !ghostEnabled;
    if (ghostEnabled && !ghostRide && ghostRides.length) {
      ghostRide = ghostRides[0];
    }
    applyTime(t);
  }
  if (event.key.toLowerCase() === 'd') {
    debugVisible = !debugVisible;
    ui.toggleDebug();
  }
});

let last = performance.now();
let fps = 60;
let fpsAccum = 0;
let fpsFrames = 0;
let lastDebug = 0;

const frame = (now: number) => {
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = now;

  if (playing && !freeze) {
    t += dt * speed;
    if (t >= T1) {
      t = T1;
      playing = false;
      ui.setPlaying(false);
    }
    applyTime(t);
  }

  fpsAccum += dt;
  fpsFrames += 1;
  if (fpsAccum >= 0.5) {
    fps = fpsFrames / fpsAccum;
    fpsAccum = 0;
    fpsFrames = 0;
  }

  if (debugVisible && now - lastDebug > 250) {
    lastDebug = now;
    const camera = world.getCamera();
    const index = indexAtTime(ride, t);
    ui.setDebug(
      [
        `t ${t.toFixed(0)}s  idx ${index}`,
        `center ${camera.center[0].toFixed(5)}, ${camera.center[1].toFixed(5)}`,
        `zoom ${camera.zoom.toFixed(2)}  pitch ${camera.pitch.toFixed(1)}  bearing ${camera.bearing.toFixed(1)}`,
        `fps ${fps.toFixed(0)}  playing ${playing}  speed ${speed}x`,
      ].join('\n'),
    );
  }

  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);

declare global {
  interface Window {
    __relive: {
      ready: boolean;
      ride: typeof ride;
      map: unknown;
      world: World;
      setPose: (pose: PoseName, animate: boolean) => void;
      setTime: (t: number) => void;
      whenIdle: () => Promise<void>;
      getState: () => {
        t: number;
        pose: PoseName;
        playing: boolean;
        follow: boolean;
        ghost: boolean;
        ghostId: string | null;
      };
    };
  }
}

window.__relive = {
  ready: true,
  ride,
  map: (world as unknown as { map?: unknown }).map,
  world,
  setPose,
  setTime: applyTime,
  whenIdle: () => world.whenIdle(),
  getState: () => ({
    t,
    pose: currentPose,
    playing,
    follow,
    ghost: ghostEnabled,
    ghostId: ghostEnabled ? ghostRide?.id ?? null : null,
  }),
};
document.body.dataset.ready = 'true';
