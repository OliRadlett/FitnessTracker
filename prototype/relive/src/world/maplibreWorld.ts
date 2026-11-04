import {
  Map as MapLibreMap,
  Marker,
  AttributionControl,
  type JumpToOptions,
  type AnimationOptions,
} from 'maplibre-gl';
import type { Feature, FeatureCollection, LineString } from 'geojson';
import type { Ride, PoseName } from '../data/ride';
import { headingAt, poseIndex } from '../data/ride';
import type { CameraState, GhostPosition, World } from './World';

const TERRAIN_TILES =
  'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

const RIDER_SVG = `
<svg viewBox="0 0 64 64" width="64" height="64" aria-hidden="true">
  <ellipse cx="32" cy="57" rx="17" ry="4" fill="rgba(0,0,0,.38)"/>
  <circle cx="17" cy="45" r="9" fill="none" stroke="#e8eef7" stroke-width="3"/>
  <circle cx="47" cy="45" r="9" fill="none" stroke="#e8eef7" stroke-width="3"/>
  <path d="M17 45 L29 29 L47 45 M29 29 L38 29 L47 45" fill="none" stroke="#e8eef7" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="35" cy="16" r="5" fill="#f59e0b"/>
  <path d="M35 21 L30 31 L36 37 L44 33" fill="none" stroke="#f59e0b" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

function routeGeoJSON(ride: Ride): FeatureCollection<LineString> {
  const features: Feature<LineString>[] = [];
  const n = ride.streams.lat.length;
  const step = 2;
  for (let i = 0; i < n - 1; i += step) {
    const j = Math.min(n - 1, i + step);
    features.push({
      type: 'Feature',
      properties: {
        grade: ride.streams.grade[i],
        d: ride.streams.d[i],
      },
      geometry: {
        type: 'LineString',
        coordinates: [
          [ride.streams.lng[i], ride.streams.lat[i]],
          [ride.streams.lng[j], ride.streams.lat[j]],
        ],
      },
    });
  }
  return { type: 'FeatureCollection', features };
}

export class MapLibreWorld implements World {
  readonly map: MapLibreMap;
  private readonly ride: Ride;
  private riderMarker!: Marker;
  private ghostMarker?: Marker;

  constructor(container: HTMLElement, ride: Ride) {
    this.ride = ride;
    this.map = new MapLibreMap({
      container,
      style: 'https://tiles.openfreemap.org/styles/liberty',
      center: [6.55, 46.45],
      zoom: 10.7,
      pitch: 55,
      bearing: -20,
      maxPitch: 85,
      canvasContextAttributes: { antialias: true },
      attributionControl: false,
      fadeDuration: 0,
    });
    this.map.addControl(
      new AttributionControl({ compact: true }),
      'bottom-right',
    );
  }

  async mount(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.map.once('load', () => resolve());
      this.map.on('error', (e: unknown) => {
        // Keep the map alive on a bad tile; surface it for debugging.
        console.warn('[relive] map error', e);
      });
    });

    this.map.addSource('terrain', {
      type: 'raster-dem',
      tiles: [TERRAIN_TILES],
      encoding: 'terrarium',
      tileSize: 256,
      maxzoom: 15,
      attribution: 'Terrain: AWS Terrain Tiles',
    });
    this.map.setTerrain({ source: 'terrain', exaggeration: 1.15 });

    const beforeWater = this.map.getLayer('water') ? 'water' : undefined;
    this.map.addLayer(
      {
        id: 'terrain-hillshade',
        type: 'hillshade',
        source: 'terrain',
        paint: {
          'hillshade-exaggeration': 0.28,
          'hillshade-shadow-color': '#1f2937',
          'hillshade-highlight-color': '#f8fafc',
          'hillshade-accent-color': '#64748b',
        },
      },
      beforeWater,
    );

    this.map.setSky({
      'sky-color': '#8aa6bd',
      'horizon-color': '#d7dde2',
      'fog-color': '#c4ced6',
      'sky-horizon-blend': 0.55,
      'horizon-fog-blend': 0.6,
      'fog-ground-blend': 0.25,
      'atmosphere-blend': 0.7,
    });
    this.map.setLight({
      anchor: 'viewport',
      color: '#fff1dc',
      intensity: 0.35,
      position: [1.5, 90, 70],
    });

    this.map.addSource('route', {
      type: 'geojson',
      data: routeGeoJSON(this.ride),
      lineMetrics: false,
    });
    this.map.addLayer({
      id: 'route-casing',
      type: 'line',
      source: 'route',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': '#0b1220',
        'line-opacity': 0.45,
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 3, 14, 6, 18, 10],
      },
    });
    this.map.addLayer({
      id: 'route',
      type: 'line',
      source: 'route',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': [
          'interpolate',
          ['linear'],
          ['get', 'grade'],
          -10,
          '#3b82f6',
          -2,
          '#93c5fd',
          0,
          '#e5e7eb',
          2,
          '#fca5a5',
          10,
          '#ef4444',
        ],
        'line-opacity': 0.95,
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2, 14, 4, 18, 7],
      },
    });

    const start = document.createElement('div');
    start.className = 'endpoint endpoint-start';
    new Marker({ element: start })
      .setLngLat([
        this.ride.streams.lng[0],
        this.ride.streams.lat[0],
      ])
      .addTo(this.map);

    const end = document.createElement('div');
    end.className = 'endpoint endpoint-end';
    new Marker({ element: end })
      .setLngLat([
        this.ride.streams.lng[this.ride.streams.lng.length - 1],
        this.ride.streams.lat[this.ride.streams.lat.length - 1],
      ])
      .addTo(this.map);

    const riderEl = document.createElement('div');
    riderEl.className = 'rider-marker';
    riderEl.innerHTML = RIDER_SVG;
    this.riderMarker = new Marker({ element: riderEl })
      .setLngLat([this.ride.streams.lng[0], this.ride.streams.lat[0]])
      .addTo(this.map);

    this.setRider(0);
    this.setPose('overview', false);
  }

  setRider(index: number): void {
    const i = Math.max(0, Math.min(this.ride.streams.lat.length - 1, index));
    this.riderMarker.setLngLat([
      this.ride.streams.lng[i],
      this.ride.streams.lat[i],
    ]);
  }

  setPose(pose: PoseName, animate: boolean): void {
    const i = poseIndex(this.ride, pose);
    this.setRider(i);
    const camera = this.cameraFor(pose, i);
    const options: JumpToOptions & AnimationOptions = {
      center: camera.center,
      zoom: camera.zoom,
      pitch: camera.pitch,
      bearing: camera.bearing,
      duration: animate ? 2400 : 0,
      essential: true,
    };
    if (animate) this.map.flyTo(options);
    else this.map.jumpTo(options);
  }

  setFollow(_enabled: boolean): void {
    // MapLibre follow is out of scope for the prototype baseline.
  }

  focusRider(index: number): void {
    const i = Math.max(0, Math.min(this.ride.streams.lat.length - 1, index));
    this.setRider(i);
    this.map.jumpTo({
      center: [this.ride.streams.lng[i], this.ride.streams.lat[i]],
      zoom: Math.max(this.map.getZoom(), 14),
    });
  }

  setGhost(position: GhostPosition | null): void {
    if (!position) {
      this.ghostMarker?.remove();
      this.ghostMarker = undefined;
      return;
    }
    const lngLat: [number, number] = [position.lng, position.lat];
    if (!this.ghostMarker) {
      const el = document.createElement('div');
      el.className = 'ghost-marker';
      el.textContent = 'G';
      this.ghostMarker = new Marker({ element: el })
        .setLngLat(lngLat)
        .addTo(this.map);
    } else {
      this.ghostMarker.setLngLat(lngLat);
    }
  }

  private cameraFor(pose: PoseName, i: number): CameraState {
    const lat = this.ride.streams.lat[i];
    const lng = this.ride.streams.lng[i];
    const heading = headingAt(this.ride, i);
    switch (pose) {
      case 'overview':
        return { center: [6.55, 46.45], zoom: 10.7, pitch: 55, bearing: -20 };
      case 'lausanne':
        // Stand over the lake, look back at the north shore.
        return { center: [lng, lat - 0.018], zoom: 14.6, pitch: 64, bearing: 0 };
      case 'montreux':
        // East end: lake foreground, town and mountains behind.
        return {
          center: [lng - 0.004, lat - 0.014],
          zoom: 14.8,
          pitch: 64,
          bearing: 15,
        };
      case 'climb':
        return { center: [lng, lat], zoom: 16.4, pitch: 78, bearing: heading };
      case 'summit':
        return {
          center: [lng, lat],
          zoom: 15.2,
          pitch: 64,
          bearing: (heading + 180) % 360,
        };
      case 'close':
        return { center: [lng, lat], zoom: 18.2, pitch: 80, bearing: heading };
    }
  }

  whenIdle(): Promise<void> {
    return new Promise((resolve) => {
      if (this.map.loaded()) {
        resolve();
        return;
      }
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      this.map.once('idle', finish);
      window.setTimeout(finish, 8000);
    });
  }

  getCamera(): CameraState {
    const c = this.map.getCenter();
    return {
      center: [c.lng, c.lat],
      zoom: this.map.getZoom(),
      pitch: this.map.getPitch(),
      bearing: this.map.getBearing(),
    };
  }

  dispose(): void {
    this.map.remove();
  }
}
