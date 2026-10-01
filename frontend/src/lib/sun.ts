/**
 * Solar position for the Relive viewer (Phase 3).
 *
 * Gives the sun's elevation + compass azimuth for a ride's start time and
 * location so the scene can be lit for the actual time of day — golden-hour
 * rides look golden, night rides are dark. Adapted from the SunCalc
 * low-precision algorithm (accuracy ~0.01°). Pure — unit-tested.
 */

const rad = Math.PI / 180;
const dayMs = 86400000;
const J2000 = 2451545;
const e = rad * 23.4397; // obliquity of the Earth

const toDays = (date: Date) => date.valueOf() / dayMs - 0.5 + 2440588 - J2000;
const solarMeanAnomaly = (d: number) => rad * (357.5291 + 0.98560028 * d);
const eclipticLongitude = (M: number) =>
  M + rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M)) + rad * 102.9372 + Math.PI;

export interface SunPosition {
  /** degrees above the horizon (negative = below) */
  elevationDeg: number;
  /** compass azimuth in degrees (0 = north, 90 = east, 180 = south) */
  azimuthDeg: number;
}

/** Sun elevation + compass azimuth at `date` for `lat`/`lng` (degrees). */
export function solarPosition(date: Date, lat: number, lng: number): SunPosition {
  const d = toDays(date);
  const M = solarMeanAnomaly(d);
  const L = eclipticLongitude(M);
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const ra = Math.atan2(Math.sin(L) * Math.cos(e), Math.cos(L));
  const H = rad * (280.16 + 360.9856235 * d) + rad * lng - ra; // hour angle
  const latR = rad * lat;
  const elevation = Math.asin(Math.sin(latR) * Math.sin(dec) + Math.cos(latR) * Math.cos(dec) * Math.cos(H));
  // SunCalc azimuth is measured from south (westward); convert to compass (N=0, E=90).
  const azFromSouth = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(latR) - Math.tan(dec) * Math.cos(latR));
  const azimuth = ((azFromSouth / rad + 180) % 360 + 360) % 360;
  return { elevationDeg: elevation / rad, azimuthDeg: azimuth };
}

/** A unit direction vector in the replay frame (x=east, y=north, z=up). */
export function sunDirection(pos: SunPosition): [number, number, number] {
  const el = rad * pos.elevationDeg;
  const az = rad * pos.azimuthDeg;
  return [Math.cos(el) * Math.sin(az), Math.cos(el) * Math.cos(az), Math.sin(el)];
}

export type Daylight = 'night' | 'blue' | 'golden' | 'day';

/**
 * Coarse daylight phase from the sun's elevation. Used for UI labelling only —
 * the actual lighting is continuous (see `sunLightModel`), so there are no
 * visible pops at these boundaries.
 */
export function daylightPhase(elevationDeg: number): Daylight {
  if (elevationDeg < -6) return 'night';
  if (elevationDeg < 0) return 'blue';
  if (elevationDeg < 10) return 'golden';
  return 'day';
}

type Rgb = [number, number, number];

function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function rgbToHex([r, g, b]: Rgb): number {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
  return (c(r) << 16) | (c(g) << 8) | c(b);
}

function css(hex: number): string {
  return `#${hex.toString(16).padStart(6, '0')}`;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const sstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpHex = (a: string, b: string, t: number): number => {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  return rgbToHex([lerp(ca[0], cb[0], t), lerp(ca[1], cb[1], t), lerp(ca[2], cb[2], t)]);
};

interface LightStop {
  e: number;
  sun: number;
  sunColor: string;
  hemi: number;
  hemiSky: string;
  top: string;
  horizon: string;
  fog: string;
  exposure: number;
  lamp: number;
}

/**
 * Authored lighting stops by sun elevation. Day and golden anchors match the
 * historical constants; night gets a real floor instead of 0.5-into-black.
 */
const LIGHT_STOPS: LightStop[] = [
  { e: -18, sun: 0.3, sunColor: '#8fb0ff', hemi: 0.55, hemiSky: '#0a1322', top: '#030509', horizon: '#081020', fog: '#05080f', exposure: 1.15, lamp: 1 },
  { e: -6, sun: 0.45, sunColor: '#93b4ff', hemi: 0.6, hemiSky: '#0e1a30', top: '#060b16', horizon: '#0e1a30', fog: '#070c16', exposure: 1.12, lamp: 0.85 },
  { e: -3, sun: 0.6, sunColor: '#a9c3f2', hemi: 0.65, hemiSky: '#1c2f4d', top: '#0a1626', horizon: '#1c2f4d', fog: '#0b1220', exposure: 1.08, lamp: 0.5 },
  { e: 0, sun: 1.2, sunColor: '#ff9a4d', hemi: 0.65, hemiSky: '#b45a24', top: '#101d33', horizon: '#b45a24', fog: '#241d28', exposure: 1.05, lamp: 0.15 },
  { e: 5, sun: 1.6, sunColor: '#ffb066', hemi: 0.7, hemiSky: '#c9762e', top: '#12233f', horizon: '#c9762e', fog: '#2a2430', exposure: 1.05, lamp: 0 },
  { e: 12, sun: 1.55, sunColor: '#ffe9c8', hemi: 0.78, hemiSky: '#4a5a78', top: '#0b1628', horizon: '#4a5a78', fog: '#141c2e', exposure: 1.02, lamp: 0 },
  { e: 25, sun: 1.4, sunColor: '#fff2df', hemi: 0.9, hemiSky: '#1b2b46', top: '#0a1428', horizon: '#1b2b46', fog: '#101a2e', exposure: 1.0, lamp: 0 },
];

export interface SunLight {
  phase: Daylight;
  sunIntensity: number;
  /** packed hex for light COLOR APIs */
  sunColor: number;
  hemiIntensity: number;
  /** packed hex for light COLOR APIs */
  hemiSky: number;
  /** css strings for sky-dome canvas + fog */
  skyTop: string;
  skyHorizon: string;
  fog: string;
  exposure: number;
  /** 0..1 darkness-driven practical-light amount (headlamp) */
  headlamp: number;
}

/**
 * Continuous sun + sky + exposure model for a solar elevation. Smoothstep
 * blends between authored stops — scrubbing time-of-day never pops, unlike
 * the old three-constant palette. Pure.
 */
export function sunLightModel(elevationDeg: number): SunLight {
  const e = Math.max(-18, Math.min(90, elevationDeg));
  let i = 0;
  while (i < LIGHT_STOPS.length - 2 && e > LIGHT_STOPS[i + 1].e) i++;
  const a = LIGHT_STOPS[i];
  const b = LIGHT_STOPS[i + 1];
  const t = sstep(a.e, b.e, e);
  return {
    phase: daylightPhase(e),
    sunIntensity: lerp(a.sun, b.sun, t),
    sunColor: lerpHex(a.sunColor, b.sunColor, t),
    hemiIntensity: lerp(a.hemi, b.hemi, t),
    hemiSky: lerpHex(a.hemiSky, b.hemiSky, t),
    skyTop: css(lerpHex(a.top, b.top, t)),
    skyHorizon: css(lerpHex(a.horizon, b.horizon, t)),
    fog: css(lerpHex(a.fog, b.fog, t)),
    exposure: lerp(a.exposure, b.exposure, t),
    headlamp: lerp(a.lamp, b.lamp, t),
  };
}

export interface LightWeather {
  overcast: boolean;
  rainy: boolean;
  snowy: boolean;
  foggy: boolean;
}

const lerpCss = (a: string, b: string, t: number) => css(lerpHex(a, b, t));

/**
 * Weather adjustments on top of the sun model. Multipliers preserve the old
 * day-look ratios (rainy sun was 0.5 against a 1.4 day base); sky greying is
 * absolute, as before. Pure.
 */
export function applyWeatherLight(base: SunLight, w: LightWeather): SunLight {
  if (!w.overcast && !w.rainy && !w.snowy && !w.foggy) return base;
  let sun = base.sunIntensity;
  let hemi = base.hemiIntensity;
  let exposure = base.exposure;
  let top = base.skyTop;
  let horizon = base.skyHorizon;
  let fog = base.fog;
  if (w.overcast) {
    top = lerpCss(top, '#39424f', 0.5);
    horizon = lerpCss(horizon, '#4a5563', 0.5);
    sun *= 0.5;
    hemi *= 1.22;
  }
  if (w.rainy) {
    top = lerpCss(top, '#2a3038', 0.7);
    horizon = lerpCss(horizon, '#3a424c', 0.7);
    fog = lerpCss(fog, '#333b45', 0.5);
    sun *= 0.36;
    hemi *= 1.11;
    exposure *= 0.9;
  }
  if (w.snowy) {
    top = lerpCss(top, '#9aa7b8', 0.7);
    horizon = lerpCss(horizon, '#c2ccd8', 0.7);
    fog = lerpCss(fog, '#c2ccd8', 0.5);
    sun *= 0.64;
    hemi *= 1.56;
  }
  if (w.foggy) {
    horizon = lerpCss(horizon, fog, 0.6);
  }
  return { ...base, sunIntensity: sun, hemiIntensity: hemi, exposure, skyTop: top, skyHorizon: horizon, fog };
}
