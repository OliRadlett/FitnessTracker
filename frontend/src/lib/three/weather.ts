/**
 * Weather classification for the Relive 3D scene (extracted from Replay3D).
 *
 * Pure helpers — no three.js/DOM — so they are unit-testable. The component
 * layer (`Replay3D`) feeds the results into sky/lighting/particle setup.
 */

/** cardinal/abbreviated wind direction → degrees (meteorological "from" direction). */
export function parseCardinal(dir: string | null): number {
  if (!dir) return 0;
  const d = dir.toUpperCase().replace(/[^A-Z]/g, '');
  const map: Record<string, number> = {
    N: 0, NNE: 22, NE: 45, ENE: 67, E: 90, ESE: 112, SE: 135, SSE: 157,
    S: 180, SSW: 202, SW: 225, WSW: 247, W: 270, WNW: 292, NW: 315, NNW: 337,
  };
  return d in map ? map[d] : 0;
}

export type WeatherFxType = 'snow' | 'rain' | 'haze';

export interface WindsockPose {
  /** yaw about the scene up axis (+X rest → downwind), radians */
  rotationZ: number;
  /** 0..1 sock lift with wind speed */
  lift: number;
}

/**
 * Windsock yaw/lift from ride wind (null = hide: calm or unknown). The sock
 * points downwind ("to" direction = cardinal + 180°), using the scene's
 * rotation.z = atan2(north, east) yaw convention. Pure.
 */
export function windsockPose(
  windSpeedKmh: number | null | undefined,
  windDirection: string | null | undefined,
): WindsockPose | null {
  if (!windDirection || windSpeedKmh == null || windSpeedKmh <= 0.5) return null;
  const toRad = (((parseCardinal(windDirection) + 180) % 360) * Math.PI) / 180;
  return {
    rotationZ: Math.atan2(Math.cos(toRad), Math.sin(toRad)),
    lift: Math.min(1, windSpeedKmh / 30),
  };
}

export interface ClassifiedWeather {
  /** lowercased conditions string (empty when unknown) */
  cond: string;
  /** precipitation in mm (0 when unknown) */
  precip: number;
  rainy: boolean;
  snowy: boolean;
  foggy: boolean;
  overcast: boolean;
  /** Wetness 0..1 drives the road sheen (rain/snow accumulation). */
  wetness: number;
  /** Particle system to spawn, or null for clear skies. */
  weatherType: WeatherFxType | null;
  /** 0..1 particle intensity from precipitation + condition base rate. */
  precipIntensity: number;
}

/**
 * Classify ride-time weather into scene flags. Mirrors the inline logic the
 * 3D viewer previously computed on every scene build.
 */
export function classifyWeather(
  conditions?: string | null,
  precipitationMm?: number | null,
): ClassifiedWeather {
  const cond = (conditions ?? '').toLowerCase();
  const precip = precipitationMm ?? 0;
  const rainy = precip > 0.2 || /rain|drizzle|shower|storm/.test(cond);
  const snowy = /snow|sleet|blizzard/.test(cond);
  const foggy = /fog|mist|haze/.test(cond);
  const overcast = !rainy && !snowy && /overcast|cloud|broken|drizzle/.test(cond);
  const wetness = Math.min(1, (rainy ? 0.6 : 0) + Math.min(0.4, precip / 4) + (snowy ? 0.5 : 0));
  const weatherType: WeatherFxType | null = snowy ? 'snow' : rainy ? 'rain' : foggy ? 'haze' : null;
  const precipIntensity = Math.min(1, precip / 6 + (rainy ? 0.6 : snowy ? 0.5 : 0.2));
  return { cond, precip, rainy, snowy, foggy, overcast, wetness, weatherType, precipIntensity };
}
