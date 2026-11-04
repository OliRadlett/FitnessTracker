import 'cesium/Build/Cesium/Widgets/widgets.css';
import {
  Cartesian3,
  Cesium3DTileset,
  CesiumTerrainProvider,
  Color,
  ConstantPositionProperty,
  ConstantProperty,
  createGooglePhotorealistic3DTileset,
  HeadingPitchRoll,
  HeightReference,
  Ion,
  IonImageryProvider,
  JulianDate,
  Math as CesiumMath,
  PolylineGlowMaterialProperty,
  ShadowMode,
  Transforms,
  Viewer,
  type Entity,
} from 'cesium';
import type { Ride, PoseName } from '../data/ride';
import { headingAt, poseIndex } from '../data/ride';
import type { CameraState, GhostPosition, World } from './World';

type Source = 'google' | 'ion';

function offsetCamera(
  lat: number,
  lng: number,
  alt: number,
  headingDeg: number,
  backM: number,
  upM: number,
): Cartesian3 {
  const rad = CesiumMath.toRadians(headingDeg);
  const dLat = (-Math.cos(rad) * backM) / 111_320;
  const dLng =
    (-Math.sin(rad) * backM) / (111_320 * Math.cos(CesiumMath.toRadians(lat)));
  return Cartesian3.fromDegrees(lng + dLng, lat + dLat, alt + upM);
}

export class CesiumWorld implements World {
  readonly map: Viewer;
  private readonly ride: Ride;
  private source: Source = 'google';
  private tileset?: Cesium3DTileset;
  private bike?: Entity;

  constructor(container: HTMLElement, ride: Ride) {
    this.ride = ride;
    this.map = new Viewer(container, {
      animation: false,
      timeline: false,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      infoBox: false,
      selectionIndicator: false,
      fullscreenButton: false,
      vrButton: false,
      shouldAnimate: false,
      scene3DOnly: true,
      baseLayer: false,
      requestRenderMode: false,
    });
  }

  async mount(): Promise<void> {
    const viewer = this.map;
    const params = new URLSearchParams(window.location.search);
    const requested = params.get('tiles');
    const googleKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
    const ionToken = import.meta.env.VITE_CESIUM_ION_TOKEN;

    this.source =
      requested === 'ion' || (!googleKey && Boolean(ionToken))
        ? 'ion'
        : googleKey
          ? 'google'
          : 'ion';

    viewer.scene.skyAtmosphere && (viewer.scene.skyAtmosphere.show = true);
    viewer.scene.fog.enabled = true;
    viewer.scene.fog.density = 0.00018;
    viewer.scene.screenSpaceCameraController.minimumZoomDistance = 1;
    viewer.scene.screenSpaceCameraController.maximumZoomDistance = 60_000;
    viewer.scene.postProcessStages.fxaa.enabled = true;

    // Freeze the sun at the ride's start time; Cesium's SunLight follows it.
    viewer.clock.currentTime = JulianDate.fromIso8601(this.ride.date);
    viewer.clock.shouldAnimate = false;

    if (this.source === 'google') {
      if (!googleKey) {
        throw new Error(
          'Missing VITE_GOOGLE_MAPS_API_KEY. Add it to prototype/relive/.env.local.',
        );
      }
      await this.mountGoogle(googleKey);
    } else {
      if (!ionToken) {
        throw new Error(
          'Missing VITE_CESIUM_ION_TOKEN. Add it to prototype/relive/.env.local, or use a Google Maps key.',
        );
      }
      await this.mountIon(ionToken);
    }

    this.addRideEntities();
    this.setPose('overview', false);
  }

  private async mountGoogle(key: string): Promise<void> {
    this.map.scene.globe.show = false;
    this.tileset = await createGooglePhotorealistic3DTileset(
      { key, onlyUsingWithGoogleGeocoder: true },
      {
        maximumScreenSpaceError: 12,
        showCreditsOnScreen: true,
      },
    );
    this.map.scene.primitives.add(this.tileset);
  }

  private async mountIon(token: string): Promise<void> {
    Ion.defaultAccessToken = token;
    this.map.scene.globe.show = true;
    this.map.scene.globe.depthTestAgainstTerrain = true;
    this.map.terrainProvider = await CesiumTerrainProvider.fromIonAssetId(1);
    const imagery = await IonImageryProvider.fromAssetId(2);
    this.map.imageryLayers.addImageryProvider(imagery);
    const buildings = await Cesium3DTileset.fromIonAssetId(96188);
    this.map.scene.primitives.add(buildings);
  }

  private addRideEntities(): void {
    const clamp = this.source === 'ion';
    const viewer = this.map;
    const n = this.ride.streams.lat.length;
    const route: number[] = [];
    for (let i = 0; i < n; i += 2) {
      route.push(
        this.ride.streams.lng[i],
        this.ride.streams.lat[i],
        this.ride.streams.alt[i] + 1.5,
      );
    }
    const positions = Cartesian3.fromDegreesArrayHeights(route);

    viewer.entities.add({
      polyline: {
        positions,
        width: 9,
        material: Color.fromCssColorString('#0b1220').withAlpha(0.45),
        clampToGround: clamp,
      },
    });
    viewer.entities.add({
      polyline: {
        positions,
        width: 4,
        material: new PolylineGlowMaterialProperty({
          color: Color.fromCssColorString('#f59e0b'),
          glowPower: 0.18,
        }),
        clampToGround: clamp,
      },
    });

    const endpoint = (i: number, color: Color) =>
      viewer.entities.add({
        position: Cartesian3.fromDegrees(
          this.ride.streams.lng[i],
          this.ride.streams.lat[i],
          this.ride.streams.alt[i] + 1.5,
        ),
        point: {
          pixelSize: 9,
          color,
          outlineColor: Color.BLACK,
          outlineWidth: 2,
          heightReference: clamp
            ? HeightReference.CLAMP_TO_GROUND
            : HeightReference.NONE,
        },
      });
    endpoint(0, Color.fromCssColorString('#3ddc84'));
    endpoint(n - 1, Color.fromCssColorString('#ff4d6d'));

    const i0 = 0;
    const pos0 = Cartesian3.fromDegrees(
      this.ride.streams.lng[i0],
      this.ride.streams.lat[i0],
      this.ride.streams.alt[i0] + 0.4,
    );
    this.bike = viewer.entities.add({
      position: pos0,
      orientation: Transforms.headingPitchRollQuaternion(
        pos0,
        new HeadingPitchRoll(CesiumMath.toRadians(headingAt(this.ride, i0)), 0, 0),
      ),
      model: {
        // Same asset as the three.js rider (`rider/bike.ts`) — one GLB in the repo.
        uri: '/models/cube-agree-c62-2026.glb',
        minimumPixelSize: 24,
        maximumScale: 20_000,
        shadows: ShadowMode.ENABLED,
        heightReference: clamp
          ? HeightReference.CLAMP_TO_GROUND
          : HeightReference.NONE,
      },
    });
  }

  setRider(index: number): void {
    if (!this.bike) return;
    const i = Math.max(0, Math.min(this.ride.streams.lat.length - 1, index));
    const pos = Cartesian3.fromDegrees(
      this.ride.streams.lng[i],
      this.ride.streams.lat[i],
      this.ride.streams.alt[i] + 0.4,
    );
    this.bike.position = new ConstantPositionProperty(pos);
    this.bike.orientation = new ConstantProperty(
      Transforms.headingPitchRollQuaternion(
        pos,
        new HeadingPitchRoll(CesiumMath.toRadians(headingAt(this.ride, i)), 0, 0),
      ),
    );
  }

  setPose(pose: PoseName, animate: boolean): void {
    const i = poseIndex(this.ride, pose);
    this.setRider(i);
    const lat = this.ride.streams.lat[i];
    const lng = this.ride.streams.lng[i];
    const alt = this.ride.streams.alt[i];
    const heading = headingAt(this.ride, i);

    let destination: Cartesian3;
    let headingDeg = heading;
    let pitchDeg = -8;

    switch (pose) {
      case 'overview':
        destination = Cartesian3.fromDegrees(6.55, 46.45, 12_000);
        headingDeg = 0;
        pitchDeg = -35;
        break;
      case 'lausanne':
        destination = Cartesian3.fromDegrees(lng, lat - 0.02, 1200);
        headingDeg = 0;
        pitchDeg = -12;
        break;
      case 'montreux':
        destination = Cartesian3.fromDegrees(lng - 0.004, lat - 0.016, 1000);
        headingDeg = 15;
        pitchDeg = -12;
        break;
      case 'climb':
        destination = offsetCamera(lat, lng, alt, heading, 80, 30);
        headingDeg = heading;
        pitchDeg = -8;
        break;
      case 'summit':
        destination = offsetCamera(lat, lng, alt, heading, 200, 100);
        headingDeg = heading;
        pitchDeg = -12;
        break;
      case 'close':
        destination = offsetCamera(lat, lng, alt, heading, 7, 1.6);
        headingDeg = heading;
        pitchDeg = -4;
        break;
    }

    const orientation = {
      heading: CesiumMath.toRadians(headingDeg),
      pitch: CesiumMath.toRadians(pitchDeg),
      roll: 0,
    };
    if (animate) {
      this.map.camera.flyTo({ destination, orientation, duration: 2.4 });
    } else {
      this.map.camera.setView({ destination, orientation });
    }
  }

  setFollow(_enabled: boolean): void {
    // Cesium follow is out of scope for the rider spike.
  }

  focusRider(index: number): void {
    this.setRider(index);
  }

  setGhost(_position: GhostPosition | null): void {
    // Ghost racing is Google-world only for the prototype.
  }

  whenIdle(): Promise<void> {
    if (!this.tileset) {
      return new Promise((resolve) => window.setTimeout(resolve, 8000));
    }
    const tileset = this.tileset;
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      tileset.initialTilesLoaded.addEventListener(finish);
      window.setTimeout(finish, 20_000);
    });
  }

  getCamera(): CameraState {
    const c = this.map.camera.positionCartographic;
    return {
      center: [
        CesiumMath.toDegrees(c.longitude),
        CesiumMath.toDegrees(c.latitude),
      ],
      zoom: 0,
      pitch: CesiumMath.toDegrees(this.map.camera.pitch),
      bearing: CesiumMath.toDegrees(this.map.camera.heading),
    };
  }

  dispose(): void {
    this.map.destroy();
  }
}
