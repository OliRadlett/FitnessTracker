import type { Ride, PoseName } from '../data/ride';
import { headingAt, poseIndex } from '../data/ride';
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
  cameraPosition: unknown;
  flyCameraTo?: (options: unknown) => void;
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

function offsetLatLng(
  lat: number,
  lng: number,
  headingDeg: number,
  backM: number,
): [number, number] {
  const rad = (headingDeg * Math.PI) / 180;
  const dLat = (-Math.cos(rad) * backM) / 111_320;
  const dLng =
    (-Math.sin(rad) * backM) /
    (111_320 * Math.cos((lat * Math.PI) / 180));
  return [lat + dLat, lng + dLng];
}

function loadGoogleMaps3D(): Promise<void> {
  if (loader) return loader;
  loader = new Promise((resolve, reject) => {
    if (customElements.get('gmp-map-3d')) {
      resolve();
      return;
    }
    const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
    if (!key) {
      reject(
        new Error(
          'Missing VITE_GOOGLE_MAPS_API_KEY. Add it to prototype/relive/.env.local.',
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
  private cameraPose = {
    lat: 46.45,
    lng: 6.55,
    alt: 15000,
    heading: 0,
    tilt: 50,
    roll: 0,
    fov: 45,
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
      const distance = this.use3dRider ? 10 : 60;
      const height = this.use3dRider ? 3.5 : 18;
      const [camLat, camLng] = offsetLatLng(lat, lng, heading, distance);
      this.setCamera(camLat, camLng, alt + height, heading, 68);
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
    const lat = this.ride.streams.lat[i];
    const lng = this.ride.streams.lng[i];
    const alt = this.ride.streams.alt[i];
    const heading = headingAt(this.ride, i);

    let camLat = lat;
    let camLng = lng;
    let camAlt = alt;
    let tilt = 75;
    let headingDeg = heading;

    switch (pose) {
      case 'overview':
        if (this.ride.id.startsWith('arthurs')) {
          camLat = (this.ride.bounds.minLat + this.ride.bounds.maxLat) / 2;
          camLng = (this.ride.bounds.minLng + this.ride.bounds.maxLng) / 2;
          camAlt = 800;
          tilt = 55;
          headingDeg = 0;
        } else {
          camLat = 46.4;
          camLng = 6.55;
          camAlt = 6000;
          tilt = 60;
          headingDeg = 0;
        }
        break;
      case 'lausanne':
        if (this.ride.id.startsWith('arthurs')) {
          [camLat, camLng] = offsetLatLng(lat, lng, heading, 150);
          camAlt = alt + 50;
          tilt = 65;
          headingDeg = heading;
        } else {
          // Stand over the lake, look back at the north shore.
          camLat = lat - 0.0025;
          camAlt = alt + 120;
          tilt = 70;
          headingDeg = 0;
        }
        break;
      case 'montreux':
        if (this.ride.id.startsWith('arthurs')) {
          [camLat, camLng] = offsetLatLng(lat, lng, heading, 150);
          camAlt = alt + 50;
          tilt = 65;
          headingDeg = heading;
        } else {
          camLat = lat - 0.0022;
          camLng = lng - 0.0005;
          camAlt = alt + 100;
          tilt = 70;
          headingDeg = 10;
        }
        break;
      case 'climb':
        if (this.use3dRider) {
          [camLat, camLng] = offsetLatLng(lat, lng, heading, 18);
          camAlt = alt + 6;
          tilt = 68;
        } else {
          [camLat, camLng] = offsetLatLng(lat, lng, heading, 60);
          camAlt = alt + 18;
          tilt = 68;
        }
        headingDeg = heading;
        break;
      case 'summit':
        [camLat, camLng] = offsetLatLng(lat, lng, heading, 800);
        camAlt = alt + 400;
        tilt = 60;
        headingDeg = heading;
        break;
      case 'close':
        if (this.use3dRider) {
          [camLat, camLng] = offsetLatLng(lat, lng, heading, 6);
          camAlt = alt + 2.2;
          tilt = 70;
        } else {
          [camLat, camLng] = offsetLatLng(lat, lng, heading, 40);
          camAlt = alt + 12;
          tilt = 70;
        }
        headingDeg = heading;
        break;
    }

    if (
      animate &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      this.tweenTo(camLat, camLng, camAlt, headingDeg, tilt);
    } else {
      this.cancelTween();
      this.setCamera(camLat, camLng, camAlt, headingDeg, tilt);
    }
    // Move the marker after the camera. A far marker jump while the camera is
    // still somewhere else crashes the Google 3D map (beta), so the camera goes
    // first and the marker follows on the next tick.
    this.lastRiderIndex = -1;
    window.setTimeout(() => this.setRider(i), 60);
  }

  focusRider(index: number): void {
    const i = Math.max(0, Math.min(this.ride.streams.lat.length - 1, index));
    const lat = this.ride.streams.lat[i];
    const lng = this.ride.streams.lng[i];
    const alt = this.ride.streams.alt[i];
    const heading = headingAt(this.ride, i);
    const [camLat, camLng] = offsetLatLng(
      lat,
      lng,
      heading,
      this.use3dRider ? 12 : 100,
    );
    this.cancelTween();
    // Detach the marker before the jump: moving a marker to a far point while
    // the camera is elsewhere crashes the Google 3D beta. Re-add it after the
    // camera has moved and the new area is loaded.
    this.riderAttached = false;
    this.rider?.remove();
    this.setCamera(
      camLat,
      camLng,
      alt + (this.use3dRider ? 4 : 40),
      heading,
      this.use3dRider ? 68 : 65,
    );
    this.lastRiderIndex = -1;
    window.setTimeout(() => {
      if (!this.rider) return;
      this.map.appendChild(this.rider);
      this.rider.setAttribute('position', `${lat},${lng},${alt}`);
      this.riderAttached = true;
      this.lastRiderIndex = i;
    }, 600);
  }

  private setCamera(
    lat: number,
    lng: number,
    alt: number,
    heading: number,
    tilt: number,
  ): void {
    this.cameraPose = {
      lat,
      lng,
      alt,
      heading,
      tilt,
      roll: 0,
      fov: this.map.fov ?? 45,
    };
    this.map.setAttribute('camera-position', `${lat},${lng},${alt}`);
    this.map.setAttribute('heading', String(heading));
    this.map.setAttribute('tilt', String(tilt));
  }

  getCameraPose(): {
    lat: number;
    lng: number;
    alt: number;
    heading: number;
    tilt: number;
    roll: number;
    fov: number;
  } {
    return { ...this.cameraPose };
  }

  private cancelTween(): void {
    if (this.tweenRaf != null) {
      cancelAnimationFrame(this.tweenRaf);
      this.tweenRaf = null;
    }
  }

  private tweenTo(
    lat: number,
    lng: number,
    alt: number,
    heading: number,
    tilt: number,
  ): void {
    this.cancelTween();
    const raw = (this.map.getAttribute('camera-position') ?? '')
      .split(',')
      .map(Number);
    const fromLat = raw[0];
    const fromLng = raw[1];
    const fromAlt = raw[2];
    if (![fromLat, fromLng, fromAlt].every(Number.isFinite)) {
      this.setCamera(lat, lng, alt, heading, tilt);
      return;
    }
    const fromHeading = Number(this.map.getAttribute('heading') ?? 0);
    const fromTilt = Number(this.map.getAttribute('tilt') ?? 0);
    const deltaHeading = ((heading - fromHeading + 540) % 360) - 180;
    const start = performance.now();
    const duration = 900;
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / duration);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      this.setCamera(
        fromLat + (lat - fromLat) * e,
        fromLng + (lng - fromLng) * e,
        fromAlt + (alt - fromAlt) * e,
        fromHeading + deltaHeading * e,
        fromTilt + (tilt - fromTilt) * e,
      );
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
