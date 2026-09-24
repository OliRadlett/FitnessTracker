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

export type Daylight = 'night' | 'golden' | 'day';

/** Coarse daylight phase from the sun's elevation (drives sky/light tinting). */
export function daylightPhase(elevationDeg: number): Daylight {
  if (elevationDeg <= -2) return 'night';
  if (elevationDeg < 10) return 'golden';
  return 'day';
}
