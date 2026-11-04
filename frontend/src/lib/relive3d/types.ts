/**
 * Relive 3D data types + pure helpers.
 *
 * Mirrors the standalone prototype's `Ride` contract so the new viewer can
 * consume the production replay endpoint (after the snake_case adapter) and
 * the dev fixtures without pulling the prototype into the app.
 */

export type PoseName =
  | 'overview'
  | 'lausanne'
  | 'montreux'
  | 'climb'
  | 'summit'
  | 'close';

export interface RideStats {
  distanceM: number;
  movingS: number;
  elapsedS: number;
  elevationGainM: number;
  ascentM: number;
  descentM: number;
  avgSpeedMps: number;
  avgHr: number;
  avgPowerW: number | null;
  calories: number;
  pauseCount: number;
  pauseS: number;
}

export interface RideWeather {
  temperature_c: number | null;
  conditions: string | null;
  wind_speed_kmh: number | null;
  wind_direction_deg: number | null;
  precipitation_mm: number | null;
}

export interface RideStreams {
  t: number[];
  d: number[];
  lat: number[];
  lng: number[];
  alt: number[];
  v: number[];
  hr: number[];
  grade: number[];
  watts?: number[];
  cadence?: number[];
}

export interface RideHighlight {
  startIdx?: number;
  endIdx?: number;
  idx?: number;
  startD?: number;
  endD?: number;
  gainM?: number;
  dropM?: number;
  gradePct?: number;
  speedKmh?: number;
  altM?: number;
  place?: string;
}

export interface RideHighlights {
  climb: RideHighlight;
  descent: RideHighlight;
  fastestKm: RideHighlight;
  highest: RideHighlight;
  lowest: RideHighlight;
}

export interface Ride {
  id: string;
  activityId?: string;
  name: string;
  date: string;
  timezone: string;
  poseLabels?: Partial<Record<PoseName, string>>;
  stats: RideStats;
  weather: RideWeather;
  bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number };
  streams: RideStreams;
  keyPoints: Record<string, number>;
  highlights: RideHighlights;
}

/** One entry in the ghost picker: a past ride on the same route. */
export interface GhostOption {
  id: string;
  label: string;
  /** Fastest ride on the route — the one to beat. */
  pb?: boolean;
}

export const POSES: { id: PoseName; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'lausanne', label: 'Lausanne' },
  { id: 'montreux', label: 'Montreux' },
  { id: 'climb', label: 'Climb' },
  { id: 'summit', label: 'Summit' },
  { id: 'close', label: 'Close' },
];

export function indexAtTime(ride: Ride, t: number): number {
  const a = ride.streams.t;
  if (t <= a[0]) return 0;
  if (t >= a[a.length - 1]) return a.length - 1;
  let lo = 0;
  let hi = a.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (a[mid] <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function indexAtDistance(ride: Ride, d: number): number {
  const a = ride.streams.d;
  if (d <= a[0]) return 0;
  if (d >= a[a.length - 1]) return a.length - 1;
  let lo = 0;
  let hi = a.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (a[mid] <= d) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function timeAtDistance(ride: Ride, d: number): number {
  return ride.streams.t[indexAtDistance(ride, d)];
}

export function headingAt(ride: Ride, i: number): number {
  const { lat, lng } = ride.streams;
  const j = Math.min(lat.length - 1, Math.max(1, i));
  const a = Math.max(0, j - 2);
  const b = Math.min(lat.length - 1, j + 2);
  const lat1 = (lat[a] * Math.PI) / 180;
  const lat2 = (lat[b] * Math.PI) / 180;
  const dLng = ((lng[b] - lng[a]) * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return h > 0 ? `${h}h ${m.toString().padStart(2, '0')}m` : `${m}m`;
}

export function formatDistance(meters: number): string {
  return `${(meters / 1000).toFixed(1)} km`;
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function poseIndex(ride: Ride, pose: PoseName): number {
  const key = pose === 'close' ? 'climb' : pose;
  return ride.keyPoints[key] ?? 0;
}

export function poseTime(ride: Ride, pose: PoseName): number {
  return ride.streams.t[poseIndex(ride, pose)];
}
