/**
 * Shared synthetic fixtures for Relive 3D visual/debug specs.
 *
 * Fully synthetic (no real activity data): a sine-based route + streams
 * generated in code, so specs are hermetic and runnable in CI with no
 * backend, no auth, and no gitignored fixture files.
 */

function encodePoints(points: Array<[number, number]>): string {
  let result = '';
  let lat = 0;
  let lng = 0;
  for (const [la, ln] of points) {
    const dLat = Math.round(la * 1e5) - lat;
    const dLng = Math.round(ln * 1e5) - lng;
    lat += dLat;
    lng += dLng;
    for (const d of [dLat, dLng]) {
      let v = d < 0 ? ~(d << 1) : d << 1;
      while (v >= 0x20) {
        result += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
        v >>= 5;
      }
      result += String.fromCharCode(v + 63);
    }
  }
  return result;
}

export interface SyntheticFixture {
  id: string;
  name: string;
  start_date: string;
  distance_meters: number;
  encoded_polyline: string;
  streams: Array<{ stream_type: string; data: { data: number[] } }>;
  weather_conditions?: string | null;
  weather_temperature?: number | null;
  weather_wind_speed_kmh?: number | null;
  weather_wind_direction?: string | null;
  weather_precipitation_mm?: number | null;
}

function makeFixture(opts: {
  id: string;
  hilly: boolean;
  rainy: boolean;
  /** ride start time (ISO) — drives the scene's time-of-day lighting */
  startDate?: string;
  /** route origin. Hilly fixtures live in the Lakes (Scafell, real 100–700 m
      relief) so hypsometric tint has something to show; flat stays in London. */
  baseLat?: number;
  baseLng?: number;
  /** barometric profile base + amplitude — kept near real DEM relief so the
      exaggeration factor stays natural instead of maxing out */
  altBase?: number;
  altAmp?: number;
}): SyntheticFixture {
  const n = 400;
  const baseLat = opts.baseLat ?? 51.5;
  const baseLng = opts.baseLng ?? -0.1;
  const altBase = opts.altBase ?? 60;
  const altAmp = opts.altAmp ?? (opts.hilly ? 18 : 0);
  const pts: Array<[number, number]> = [];
  const alt: number[] = [];
  const vel: number[] = [];
  const power: number[] = [];
  const hr: number[] = [];
  const cadence: number[] = [];
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1);
    // ~2.5 km route (golden-hour default start, like prod data).
    pts.push([baseLat + Math.sin(f * Math.PI * 4) * 0.002 + f * 0.004, baseLng + f * 0.03]);
    alt.push(altBase + Math.sin(f * Math.PI * 6) * altAmp);
    vel.push(8);
    power.push(150 + Math.sin(f * Math.PI * 6) * 60);
    hr.push(140 + Math.sin(f * Math.PI * 2) * 12);
    cadence.push(85);
  }
  return {
    id: opts.id,
    name: opts.hilly ? 'Visual Hilly' : 'Visual Flat',
    // Default 16:09 UTC late September ≈ golden hour in the UK.
    start_date: opts.startDate ?? '2026-09-22T16:09:42+00:00',
    distance_meters: 3200,
    encoded_polyline: encodePoints(pts),
    streams: [
      { stream_type: 'velocity', data: { data: vel } },
      { stream_type: 'altitude', data: { data: alt } },
      { stream_type: 'watts', data: { data: power } },
      { stream_type: 'heartrate', data: { data: hr } },
      { stream_type: 'cadence', data: { data: cadence } },
    ],
    ...(opts.rainy
      ? {
          weather_conditions: 'rain',
          weather_temperature: 12,
          weather_wind_speed_kmh: 18,
          weather_wind_direction: 'SW',
          weather_precipitation_mm: 2.5,
        }
      : {
          weather_conditions: 'clear',
          weather_temperature: 18,
          weather_wind_speed_kmh: 8,
          weather_wind_direction: 'W',
          weather_precipitation_mm: 0,
        }),
  };
}

const LAKES = { baseLat: 54.44, baseLng: -3.23, altBase: 150, altAmp: 250 };

export const VISUAL_HILLY = makeFixture({ id: 'visual-hilly', hilly: true, rainy: false, ...LAKES });
export const VISUAL_FLAT_RAINY = makeFixture({ id: 'visual-flat-rainy', hilly: false, rainy: true });
// Same hilly route at solar noon (≈36° elevation, full day look) and deep
// night — the Phase 2 time-of-day baselines.
export const VISUAL_DAY = makeFixture({
  id: 'visual-day',
  hilly: true,
  rainy: false,
  startDate: '2026-09-22T12:00:00+00:00',
  ...LAKES,
});
export const VISUAL_NIGHT = makeFixture({
  id: 'visual-night',
  hilly: true,
  rainy: false,
  startDate: '2026-09-22T23:30:00+00:00',
  ...LAKES,
});
