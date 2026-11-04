import type { Ride, PoseName } from '@/lib/relive3d/types';
import { headingAt, poseIndex } from '@/lib/relive3d/types';
import type { CameraState, GhostPosition, World } from './World';

interface Map3D extends HTMLElement {
  center: unknown;
  range: number;
  tilt: number;
  heading: number;
  fov: number;
  mode: string;
  qualityMode: string;
  defaultUIHidden: boolean;
}

/**
 * A camera framing, expressed the way the Google 3D map actually understands it:
 * a look-at point on the ground plus how high the camera sits above it.
 *
 * `range` (the map's camera-to-target distance) is derived from `height` and
 * `tilt`, so every pose states its intent in metres of altitude, which is what
 * you actually reason about when framing a hill.
 */
interface CameraTarget {
  lat: number;
  lng: number;
  /** Altitude of the look-at point, metres. */
  alt: number;
  /** How high the camera sits above the look-at point, metres. */
  height: number;
  /** Camera tilt from vertical, degrees (0 = straight down). */
  tilt: number;
  heading: number;
}

interface Marker3D extends HTMLElement {
  position: unknown;
  label: string;
  altitudeMode: string;
  sizePreserved: boolean;
}

interface Polyline3D extends HTMLElement {
  path: unknown;
  strokeColor: string;
  strokeWidth: number;
  outerColor: string;
  outerWidth: number;
  altitudeMode: string;
  drawsOccludedSegments: boolean;
}

let loader: Promise<void> | undefined;


function loadGoogleMaps3D(): Promise<void> {
  if (loader) return loader;
  loader = new Promise((resolve, reject) => {
    if (customElements.get('gmp-map-3d')) {
      resolve();
      return;
    }
    const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    if (!key) {
      reject(
        new Error(
          'Missing NEXT_PUBLIC_GOOGLE_MAPS_API_KEY. Add it to frontend/.env.local.',
        ),
      );
      return;
    }
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${key}&v=beta&libraries=maps3d&loading=async`;
    script.async = true;
    const timeout = window.setTimeout(() => {
      reject(new Error('Timed out waiting for the Google Maps 3D API.'));
    }, 20_000);
    script.onload = () => {
      customElements
        .whenDefined('gmp-map-3d')
        .then(() => {
          window.clearTimeout(timeout);
          resolve();
        })
        .catch((error) => {
          window.clearTimeout(timeout);
          reject(error);
        });
    };
    script.onerror = () => {
      window.clearTimeout(timeout);
      reject(new Error('Failed to load the Google Maps JavaScript API.'));
    };
    document.head.appendChild(script);
  });
  return loader;
}

export class Google3DWorld implements World {
  readonly map: Map3D;
  private readonly ride: Ride;
  private readonly use3dRider: boolean;
  private rider?: Marker3D;
  private riderAttached = false;
  private lastRiderIndex = -1;
  private ghost?: Marker3D;
  private currentIndex = 0;
  private target: CameraTarget = {
    lat: 46.45,
    lng: 6.55,
    alt: 0,
    height: 9642,
    tilt: 50,
    heading: 0,
  };
  private follow = false;
  private lastFollowAt = 0;
  private tweenRaf: number | null = null;

  constructor(container: HTMLElement, ride: Ride, use3dRider = false) {
    this.ride = ride;
    this.use3dRider = use3dRider;
    this.map = document.createElement('gmp-map-3d') as Map3D;
    this.map.setAttribute('mode', 'SATELLITE');
    this.map.setAttribute('center', '46.45,6.55');
    this.map.setAttribute('range', '15000');
    this.map.setAttribute('tilt', '50');
    this.map.setAttribute('heading', '0');
    this.map.setAttribute('fov', '45');
    this.map.setAttribute('default-ui-hidden', 'true');
    container.appendChild(this.map);
  }

  async mount(): Promise<void> {
    await loadGoogleMaps3D();
    this.map.mode = 'SATELLITE';
    this.map.qualityMode = 'FIDELITY';
    this.map.defaultUIHidden = true;
    this.map.fov = 45;

    await this.waitForSteady();
    this.addRoute();
    this.addEndpoints();
    if (!this.use3dRider) this.addRider();
    this.setPose('overview', false);
  }

  private waitForSteady(): Promise<void> {
    return new Promise((resolve) => {
      const started = performance.now();
      const tick = () => {
        const steady = (this.map as unknown as { isSteady?: unknown }).isSteady;
        const ready =
          typeof steady === 'function'
            ? Boolean((steady as () => boolean).call(this.map))
            : Boolean(steady);
        const positioned = Boolean(this.map.getAttribute('camera-position'));
        const elapsed = performance.now() - started;
        // The beta map needs a beat after the first camera position before its
        // internal style/scene is ready for children or camera attributes.
        if ((ready || positioned) && elapsed > 2500) {
          resolve();
          return;
        }
        if (elapsed > 15_000) {
          resolve();
          return;
        }
        requestAnimationFrame(tick);
      };
      tick();
    });
  }

  private addRoute(): void {
    const n = this.ride.streams.lat.length;
    const path: { lat: number; lng: number; altitude: number }[] = [];
    for (let i = 0; i < n; i += 2) {
      path.push({
        lat: this.ride.streams.lat[i],
        lng: this.ride.streams.lng[i],
        altitude: this.ride.streams.alt[i],
      });
    }
    const line = document.createElement('gmp-polyline-3d') as Polyline3D;
    this.map.appendChild(line);
    line.setAttribute('stroke-color', '#f59e0b');
    line.setAttribute('stroke-width', '4');
    line.setAttribute('outer-color', '#0b1220');
    line.setAttribute('outer-width', '1');
    line.setAttribute('altitude-mode', 'CLAMP_TO_GROUND');
    line.setAttribute('draws-occluded-segments', 'true');
    line.path = path;
  }

  private addEndpoints(): void {
    const endpoint = (i: number, label: string) => {
      const marker = document.createElement('gmp-marker-3d') as Marker3D;
      this.map.appendChild(marker);
      marker.setAttribute(
        'position',
        `${this.ride.streams.lat[i]},${this.ride.streams.lng[i]},${this.ride.streams.alt[i]}`,
      );
      marker.setAttribute('altitude-mode', 'CLAMP_TO_GROUND');
      marker.setAttribute('label', label);
      marker.setAttribute('size-preserved', 'true');
    };
    endpoint(0, 'S');
    endpoint(this.ride.streams.lat.length - 1, 'F');
  }

  private addRider(): void {
    this.rider = document.createElement('gmp-marker-3d') as Marker3D;
    this.map.appendChild(this.rider);
    this.rider.setAttribute('altitude-mode', 'CLAMP_TO_GROUND');
    this.rider.setAttribute('label', '🚴');
    this.rider.setAttribute('size-preserved', 'true');
    this.riderAttached = true;
    this.setRider(0);
  }

  enableRiderMarker(index = 0): void {
    if (!this.rider) this.addRider();
    this.lastRiderIndex = -1;
    this.setRider(index);
  }

  setRider(index: number): void {
    if (!this.rider || !this.riderAttached) return;
    const i = Math.max(0, Math.min(this.ride.streams.lat.length - 1, index));
    if (i === this.lastRiderIndex) return;
    this.lastRiderIndex = i;
    this.currentIndex = i;
    const lat = this.ride.streams.lat[i];
    const lng = this.ride.streams.lng[i];
    const alt = this.ride.streams.alt[i];
    const heading = headingAt(this.ride, i);
    this.rider.setAttribute('position', `${lat},${lng},${alt}`);

    if (this.follow && Date.now() - this.lastFollowAt > 150) {
      this.lastFollowAt = Date.now();
      this.cancelTween();
      this.applyTarget({
        lat,
        lng,
        alt,
        height: this.use3dRider ? 3.5 : 18,
        tilt: 68,
        heading,
      });
    }
  }

  setGhost(position: GhostPosition | null): void {
    if (!position) {
      this.ghost?.remove();
      this.ghost = undefined;
      return;
    }
    if (!this.ghost) {
      this.ghost = document.createElement('gmp-marker-3d') as Marker3D;
      this.map.appendChild(this.ghost);
      this.ghost.setAttribute('altitude-mode', 'CLAMP_TO_GROUND');
      this.ghost.setAttribute('label', 'G');
      this.ghost.setAttribute('size-preserved', 'true');
    }
    this.ghost.setAttribute(
      'position',
      `${position.lat},${position.lng},${position.alt}`,
    );
  }

  setFollow(enabled: boolean): void {
    this.follow = enabled;
    this.cancelTween();
    if (enabled) {
      this.lastRiderIndex = -1;
      this.setRider(this.currentIndex);
    }
  }

  setPose(pose: PoseName, animate: boolean): void {
    const i = poseIndex(this.ride, pose);
    const target = this.targetFor(pose, i);
    if (
      animate &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      this.flyTo(target);
    } else {
      this.cancelTween();
      this.applyTarget(target);
    }
    // Move the marker after the camera. A far marker jump while the camera is
    // still somewhere else crashes the Google 3D map (beta), so the camera goes
    // first and the marker follows on the next tick.
    this.lastRiderIndex = -1;
    window.setTimeout(() => this.setRider(i), 60);
  }

  /**
   * Where each preset puts the camera.
   *
   * Poses that follow the rider express the framing as "look at the rider from
   * N metres up", so the rider stays centred and the map derives the camera's
   * horizontal offset from `tilt`.
   *
   * Nothing here may branch on the ride's identity: production rides arrive with
   * UUIDs and arbitrary locations, so the framing has to come from the ride's
   * own geometry (bounds, key points) rather than from the fixture it was tuned
   * against.
   */
  private targetFor(pose: PoseName, i: number): CameraTarget {
    const lat = this.ride.streams.lat[i];
    const lng = this.ride.streams.lng[i];
    const alt = this.ride.streams.alt[i];
    const heading = headingAt(this.ride, i);

    switch (pose) {
      case 'overview':
        return this.overviewTarget();
      case 'lausanne':
        // Look along the route rather than due north. The fixed north-facing
        // camera was tuned on the lake's north shore and, on any other ride,
        // pointed at whatever happened to be inland — a hillside with the route
        // running across the frame.
        return { lat, lng, alt, height: 170, tilt: 65, heading };
      case 'montreux':
        return { lat, lng, alt, height: 150, tilt: 66, heading };
      case 'climb':
        return { lat, lng, alt, height: this.use3dRider ? 6 : 45, tilt: 68, heading };
      case 'summit':
        return { lat, lng, alt, height: 400, tilt: 60, heading };
      case 'close':
        return { lat, lng, alt, height: this.use3dRider ? 2.2 : 30, tilt: 70, heading };
    }
  }

  /**
   * Frame the whole ride: centre on the bounding box and back off far enough
   * that its longer side fits the viewport. The visible ground width at the
   * look-at distance is `2 * range * tan(hfov/2)`, so the required range follows
   * from the ride's span — which is why a 13 km loop and a 175 km lap both land
   * as a readable overview instead of one being a dot and the other off-screen.
   */
  private overviewTarget(): CameraTarget {
    const { minLat, maxLat, minLng, maxLng } = this.ride.bounds;
    const midLat = (minLat + maxLat) / 2;
    const spanLat = (maxLat - minLat) * 111_320;
    const spanLng =
      (maxLng - minLng) * 111_320 * Math.cos((midLat * Math.PI) / 180);
    const span = Math.max(spanLat, spanLng, 400);

    const aspect =
      this.map.clientWidth > 0 && this.map.clientHeight > 0
        ? this.map.clientWidth / this.map.clientHeight
        : 16 / 9;
    const halfFov = Math.tan(((this.map.fov || 45) * Math.PI) / 360);
    const range = (span * 1.15) / (2 * halfFov * Math.min(aspect, 1));
    const tilt = 55;

    return {
      lat: midLat,
      lng: (minLng + maxLng) / 2,
      alt: 0,
      height: range * Math.cos((tilt * Math.PI) / 180),
      tilt,
      heading: 0,
    };
  }

  focusRider(index: number): void {
    const i = Math.max(0, Math.min(this.ride.streams.lat.length - 1, index));
    const lat = this.ride.streams.lat[i];
    const lng = this.ride.streams.lng[i];
    const alt = this.ride.streams.alt[i];
    const heading = headingAt(this.ride, i);
    this.cancelTween();
    // Detach the marker before the jump: moving a marker to a far point while
    // the camera is elsewhere crashes the Google 3D beta. Re-add it after the
    // camera has moved and the new area is loaded.
    this.riderAttached = false;
    this.rider?.remove();
    this.applyTarget({
      lat,
      lng,
      alt,
      height: this.use3dRider ? 4 : 40,
      tilt: this.use3dRider ? 68 : 65,
      heading,
    });
    this.lastRiderIndex = -1;
    window.setTimeout(() => {
      if (!this.rider) return;
      this.map.appendChild(this.rider);
      this.rider.setAttribute('position', `${lat},${lng},${alt}`);
      this.riderAttached = true;
      this.lastRiderIndex = i;
    }, 600);
  }

  /**
   * Push a framing to the map through its documented camera properties.
   *
   * Deliberately *not* the `camera-position` attribute: the map treats that as
   * a camera write while still honouring whatever `center`/`range` it already
   * holds, and the two fight — the engine ends up with a camera thousands of
   * metres from its own look-at point (observed as a 72 km range and a look-at
   * 30 km below sea level), so the framing silently drifts. `center` + `range`
   * + `tilt` + `heading` is one coherent statement and lands exactly.
   */
  private applyTarget(target: CameraTarget): void {
    this.target = target;
    const tilt = Math.min(89, Math.max(0, target.tilt));
    const range = target.height / Math.cos((tilt * Math.PI) / 180);
    this.map.setAttribute('center', `${target.lat},${target.lng},${target.alt}`);
    this.map.setAttribute('range', range.toFixed(1));
    this.map.setAttribute('tilt', tilt.toFixed(2));
    this.map.setAttribute(
      'heading',
      (((target.heading % 360) + 360) % 360).toFixed(2),
    );
  }

  private cancelTween(): void {
    if (this.tweenRaf != null) {
      cancelAnimationFrame(this.tweenRaf);
      this.tweenRaf = null;
    }
  }

  private flyTo(to: CameraTarget): void {
    this.cancelTween();
    const from = { ...this.target };
    const deltaHeading = ((to.heading - from.heading + 540) % 360) - 180;
    const start = performance.now();
    const duration = 900;
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / duration);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      this.applyTarget({
        lat: from.lat + (to.lat - from.lat) * e,
        lng: from.lng + (to.lng - from.lng) * e,
        alt: from.alt + (to.alt - from.alt) * e,
        height: from.height + (to.height - from.height) * e,
        tilt: from.tilt + (to.tilt - from.tilt) * e,
        heading: from.heading + deltaHeading * e,
      });
      if (k < 1) {
        this.tweenRaf = requestAnimationFrame(step);
      } else {
        this.tweenRaf = null;
      }
    };
    this.tweenRaf = requestAnimationFrame(step);
  }

  whenIdle(): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, 5000));
  }

  getCamera(): CameraState {
    const center = (this.map.getAttribute('center') ?? '0,0').split(',');
    return {
      center: [Number(center[1]), Number(center[0])],
      zoom: Number(this.map.getAttribute('range') ?? 0),
      pitch: Number(this.map.getAttribute('tilt') ?? 0),
      bearing: Number(this.map.getAttribute('heading') ?? 0),
    };
  }

  dispose(): void {
    this.cancelTween();
    this.map.remove();
  }
}
